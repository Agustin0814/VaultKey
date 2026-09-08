use crate::errors::{Error, Result};
use std::time::{Duration, Instant};
use zeroize::Zeroizing;
pub trait ClipboardAccess {
    fn read(&mut self) -> Result<String>;
    fn write(&mut self, text: &str) -> Result<()>;
    fn clear(&mut self) -> Result<()>;
}
pub struct Native;
impl ClipboardAccess for Native {
    fn read(&mut self) -> Result<String> {
        arboard::Clipboard::new()
            .map_err(|_| Error::Clipboard)?
            .get_text()
            .map_err(|_| Error::Clipboard)
    }
    fn write(&mut self, text: &str) -> Result<()> {
        arboard::Clipboard::new()
            .map_err(|_| Error::Clipboard)?
            .set_text(text)
            .map_err(|_| Error::Clipboard)
    }
    fn clear(&mut self) -> Result<()> {
        arboard::Clipboard::new()
            .map_err(|_| Error::Clipboard)?
            .clear()
            .map_err(|_| Error::Clipboard)
    }
}
#[derive(Default)]
pub struct ClipboardGuard {
    expected: Option<Zeroizing<String>>,
    deadline: Option<Instant>,
}
impl ClipboardGuard {
    pub fn copy(&mut self, c: &mut impl ClipboardAccess, text: &str) -> Result<()> {
        c.write(text)?;
        self.expected = Some(Zeroizing::new(text.to_string()));
        self.deadline = Some(Instant::now() + Duration::from_secs(30));
        Ok(())
    }
    pub fn clear(&mut self, c: &mut impl ClipboardAccess, force: bool) -> Result<()> {
        if self.expected.is_none() || (!force && self.deadline.is_some_and(|d| Instant::now() < d))
        {
            return Ok(());
        }
        // Always wipe our copy at expiry/lock, including when the OS clipboard fails.
        let expected = self.expected.take();
        self.deadline = None;
        let current = Zeroizing::new(c.read()?);
        if expected.as_deref().is_some_and(|s| s == &*current) {
            c.clear()?;
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    struct Fake(String);
    impl ClipboardAccess for Fake {
        fn read(&mut self) -> Result<String> {
            Ok(self.0.clone())
        }
        fn write(&mut self, s: &str) -> Result<()> {
            self.0 = s.into();
            Ok(())
        }
        fn clear(&mut self) -> Result<()> {
            self.0.clear();
            Ok(())
        }
    }
    #[test]
    fn clears_and_preserves_new_content() {
        let mut c = Fake(String::new());
        let mut g = ClipboardGuard::default();
        g.copy(&mut c, "fake-secret").unwrap();
        g.deadline = Some(Instant::now());
        g.clear(&mut c, false).unwrap();
        assert!(c.0.is_empty());
        g.copy(&mut c, "fake-secret").unwrap();
        c.0 = "new-content".into();
        g.clear(&mut c, true).unwrap();
        assert_eq!(c.0, "new-content");
    }
    #[test]
    fn clipboard_failure_does_not_retain_secret() {
        struct Unavailable;
        impl ClipboardAccess for Unavailable {
            fn read(&mut self) -> Result<String> {
                Err(Error::Clipboard)
            }
            fn write(&mut self, _: &str) -> Result<()> {
                Ok(())
            }
            fn clear(&mut self) -> Result<()> {
                Err(Error::Clipboard)
            }
        }
        let mut g = ClipboardGuard::default();
        g.copy(&mut Unavailable, "fake-secret").unwrap();
        assert!(g.clear(&mut Unavailable, true).is_err());
        assert!(g.expected.is_none());
        assert!(g.deadline.is_none());
    }
}
