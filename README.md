# VaultKey

**Your accounts. Connected. Protected.**

VaultKey es una aplicación de escritorio para guardar credenciales y representar sus relaciones, completamente offline. Una entrada puede usar correo, usuario o teléfono con contraseña, un proveedor como Google o Apple, una cuenta vinculada o un método personalizado.

> VaultKey es un proyecto educativo y de portafolio diseñado siguiendo prácticas modernas de seguridad, pero no ha sido sometido a una auditoría criptográfica o de seguridad profesional.

## Funciones

- Creación, desbloqueo y bloqueo de una bóveda local.
- Credenciales con servicio, método, correo, usuario, teléfono, contraseña opcional, cuenta vinculada, URL, categoría, notas y favoritos.
- Creación, edición, eliminación con confirmación y búsqueda por servicio, correo, usuario, categoría y método.
- Relaciones cifradas y consulta de cuentas dependientes; se rechazan ciclos y no se permite borrar una cuenta con dependientes.
- Contraseñas ocultas; revelación explícita y copia desde Rust.
- Limpieza del portapapeles a los 30 segundos si su texto todavía coincide con el copiado.
- Bloqueo por inactividad a los 5 minutos, impuesto por Rust; intervalo configurable para la sesión.
- Cambio de contraseña maestra mediante reencriptado de la clave de bóveda, sin modificar los ciphertexts de las credenciales.
- Recursos gráficos opcionales y fallbacks locales.

## Stack y arquitectura

Tauri 2 · Rust · React 19 · TypeScript · Vite · SQLite bundled / rusqlite · RustCrypto Argon2id y XChaCha20-Poly1305 · zeroize · secrecy · UUID v4 · arboard.

```text
React (interfaz, formularios y vistas)
  → comandos Tauri (IPC local)
    → Vault Manager (validación, búsqueda, relaciones, sesión)
      → Crypto (KEK / DEK, cifrado autenticado)
      → SQLite (solo payloads cifrados y metadata técnico)
      → ClipboardGuard (portapapeles nativo)
```

React no accede a SQLite ni deriva o almacena claves. Las listas devuelven una proyección sin contraseña; la contraseña solo se devuelve al pulsar Mostrar. Copiar no entrega la contraseña a JavaScript. Todos los comandos de credenciales comprueban el bloqueo en Rust.

## Instalación en Windows

Requisitos:

1. Node.js 22 LTS o posterior y npm.
2. Rust estable con toolchain MSVC (`rustup`). Se recomienda Rust 1.98 o posterior para el lockfile incluido.
3. Visual Studio 2022 Build Tools, carga **Desktop development with C++**, MSVC y Windows SDK.
4. Microsoft Edge WebView2 Runtime, incluido normalmente en Windows 11.

Consulta los [prerrequisitos oficiales de Tauri](https://v2.tauri.app/start/prerequisites/). Tras instalar Rust o Build Tools, abre una terminal nueva.

```powershell
cd C:\Users\Nicolas\Desktop\Github\vaultkey
npm install
npm run tauri dev
```

`npm run dev` abre únicamente la interfaz en navegador: la creación/desbloqueo permanecen deshabilitados porque no hay proceso Rust. No existe backend alternativo ni almacenamiento de prueba dentro de la aplicación.

## Compilación

```powershell
npm run tauri build
```

El instalador NSIS queda en `src-tauri/target/release/bundle/nsis/`; el ejecutable está en `src-tauri/target/release/vaultkey.exe`. El instalador no está firmado. WebView2 debe estar instalado de antemano: se omite su descarga automática para que la instalación de VaultKey no requiera conexión.

La descarga inicial de herramientas, paquetes y herramientas de empaquetado requiere Internet. La aplicación compilada y sus operaciones de bóveda no llaman a servicios externos. En macOS/Linux se necesitan los prerrequisitos de Tauri específicos del sistema y seleccionar un bundle apropiado (`--bundles app` / `--bundles deb`); esos sistemas no son el objetivo de verificación inicial.

## Modelo criptográfico

Al crear la bóveda, el RNG del sistema operativo genera un salt de 128 bits y una DEK aleatoria de 256 bits. Argon2id deriva una KEK de 256 bits a partir de la contraseña maestra y el salt; XChaCha20-Poly1305 envuelve la DEK con esta KEK. Solo la DEK protegida llega a SQLite.

El perfil de formato 1 usa **64 MiB (65536 KiB), 3 iteraciones, 4 vías, Argon2 versión 0x13**, basado en la segunda recomendación de [RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html#section-4). Se persisten los parámetros y versiones. Antes de derivar se valida el perfil permitido, evitando asignaciones arbitrarias desde metadata alterado. Una futura migración debe ampliar explícitamente los perfiles aceptados.

Cada cifrado usa un nonce nuevo aleatorio de 192 bits. El payload completo está protegido por XChaCha20-Poly1305; el AAD separa los dominios DEK, credenciales y relaciones y vincula cada registro a su UUID y versión. Mover un ciphertext a otro ID o tipo provoca un error de autenticación. No se devuelven resultados parciales si falla el descifrado o la deserialización.

La autenticación de la DEK envuelta comprueba la contraseña. Un fallo produce “Incorrect password or invalid vault”; no existe un hash de verificación adicional. El cambio de contraseña verifica la actual, genera otro salt y nonce, deriva otra KEK y actualiza únicamente el envoltorio de la DEK mediante una operación atómica de SQLite.

## SQLite y datos sensibles

`vault.db` reside en el directorio de datos devuelto por Tauri para `com.vaultkey.desktop`. En Windows normalmente es `%APPDATA%\com.vaultkey.desktop\vault.db`, fuera del repositorio.

| Tabla | Contenido persistido |
| --- | --- |
| `metadata` | versión de formato, parámetros y salt Argon2id, nonce y DEK envuelta |
| `credentials` | UUID, nonce, payload autenticado cifrado |
| `relations` | UUID independiente, nonce, payload autenticado cifrado |

Servicio, método, identificadores, contraseña, enlaces, notas, categoría, favoritos, fechas y endpoints de relaciones permanecen dentro del cifrado. No hay índices personales en texto plano. La búsqueda descifra en Rust, compara en memoria y devuelve proyecciones sin contraseña. SQLite puede revelar el número y tamaño aproximado de registros: no es cifrado de archivo completo. Las transacciones mantienen sincronizadas credenciales y relaciones; los errores de base de datos están sanitizados y se configura un tiempo de espera de 3 segundos para contención.

La DEK se conserva en `secrecy::Secret` únicamente durante la sesión desbloqueada. KEK, buffers y payloads usan `zeroize` / `Zeroizing` / `ZeroizeOnDrop` cuando corresponde. Los formularios borran los inputs de contraseña inmediatamente al enviar y no guardan secretos en localStorage, sessionStorage ni estado global. JavaScript, el IPC, las bibliotecas y el sistema operativo pueden crear copias de memoria cuya limpieza absoluta no puede garantizarse. Las contraseñas de cuentas se cifran de forma reversible: no se sustituyen por hashes.

El bloqueo limpia la DEK y el estado de React, invalida respuestas pendientes y oculta secretos. La ventana oculta las contraseñas reveladas al perder el foco. El proceso Rust revisa cada segundo el tiempo de inactividad y cada comando verifica el vencimiento; el frontend transmite eventos de actividad reales y consulta el estado como respaldo. El portapapeles se limpia al bloquear o cerrar cuando es posible. Si el sistema operativo falla, se avisa al usuario para que lo limpie manualmente y se destruye igualmente la copia interna del secreto.

## Pérdida de contraseña

**Si pierdes tu contraseña maestra, no podremos recuperar tus credenciales.**

No hay recuperación, servidor, contraseña universal, preguntas secretas ni puerta trasera. Una futura recovery key podría ser otro envoltorio de la misma DEK con un esquema nuevo: no está implementada en este MVP.

## Recursos gráficos

Coloca el icono gráfico en `public/assets/images/logo.png`. El texto VaultKey se genera con HTML/CSS.

Los SVG esperados en `public/assets/icons/` son:

```text
lock.svg unlock.svg add.svg edit.svg delete.svg search.svg copy.svg
show.svg hide.svg email.svg user.svg phone.svg password.svg link.svg
google.svg facebook.svg apple.svg microsoft.svg notes.svg category.svg
settings.svg warning.svg success.svg
```

Las rutas se detectan al iniciar Vite / compilar. Los recursos ausentes o con fallo de carga usan iconos Lucide locales. Reinicia Vite si añades nuevos archivos y recompila para actualizar una aplicación instalada. El icono de empaquetado provisional en `src-tauri/icons/` es independiente; puedes regenerarlo con `npm run tauri icon public/assets/images/logo.png`.

## Estructura

```text
public/assets/               Logo y SVG opcionales
src/
  components/common/         Marca, iconos y diálogos accesibles
  components/credentials/    Formulario de credencial
  pages/                     Alta, desbloqueo y ajustes
  services/tauri.ts           Contrato IPC tipado
  types/                     Modelo TypeScript
  styles/                    Diseño y adaptación de pantalla
  App.tsx                    Navegación, vistas y ciclo de sesión
src-tauri/
  capabilities/              Permisos mínimos de la ventana
  src/crypto.rs              Argon2id y XChaCha20-Poly1305
  src/database.rs            Esquema y acceso SQLite
  src/vault.rs               Bóveda, CRUD y relaciones
  src/vault/tests.rs         Pruebas del núcleo
  src/clipboard.rs           Portapapeles y pruebas con sustituto
  src/models.rs              Payloads tipados
  src/errors.rs              Errores sanitizados
  src/lib.rs                 Comandos y ciclo nativo
```

## Pruebas

```powershell
npm run build
npm run test:rust
npm run check:rust
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

Las pruebas usan datos ficticios y directorios temporales. Cubren roundtrip binario, nonces distintos, manipulación de ciphertext/AAD, contraseña incorrecta, persistencia, cambio de contraseña sin alterar credenciales cifradas, CRUD, búsqueda, relaciones, ciclos, dependientes, payload corrupto, parámetros KDF hostiles, bloqueo, vencimiento y comportamiento del portapapeles. No se incluye una bóveda real en Git.

## Instancias simultáneas

La bóveda utiliza un bloqueo SQLite exclusivo mientras está abierta para impedir escrituras desde una segunda instancia. Cierra la primera aplicación antes de abrir otra; si la base no está disponible, la interfaz permite reintentar sin destruir datos.

## Prueba integrada de escritorio (Windows)

Con `npm run dev` activo en otra terminal:

```powershell
cargo build --manifest-path src-tauri/Cargo.toml
npm run test:desktop
```

La prueba inicia el ejecutable debug con una bóveda temporal en el directorio temporal del sistema y conecta Playwright a WebView2 localmente por el puerto 9227. Comprueba formularios, CRUD, búsqueda, relaciones, cambio de contraseña, persistencia tras reinicio y 60 segundos reales de inactividad. Solo utiliza datos ficticios; limpia la bóveda al finalizar. El parámetro de aislamiento `VAULTKEY_TEST_DATA_DIR` está compilado exclusivamente en debug y no existe en release. No habilites depuración remota al usar datos reales.

## Limitaciones y futuras mejoras

- Sin auditoría profesional; no protege contra malware, keyloggers, capturas de pantalla o un sistema operativo comprometido.
- Zeroization es una mitigación de mejor esfuerzo; no garantiza eliminar copias en swap, volcados o memoria administrada.
- El portapapeles del sistema y su historial pueden conservar copias. La comparación y el borrado no son atómicos en todas las plataformas; no se garantiza impedir una carrera con otra aplicación. Si una app copia exactamente el mismo texto, no puede distinguirse por comparación.
- Sin detección de restauración de una copia antigua o borrado completo de filas válidas. La autenticación detecta alteraciones de payloads, no un rollback de toda la base.
- Sin sincronización, telemetría, apertura automática de URLs, exportación en claro, recuperación o análisis de filtraciones.
- Relaciones de un padre por credencial; modelo extensible a relaciones múltiples. Vista jerárquica sencilla, sin grafo.
- Sin servicio de backups: una copia manual debe realizarse con la aplicación cerrada y custodiarse como material sensible.
- Ajustes de tiempo por sesión, sin desactivar el bloqueo. Próximos pasos: auditoría independiente, backups cifrados, migraciones explícitas, recovery key opcional, pruebas de distribución macOS/Linux y firma de instaladores.

El `.gitignore` excluye bases de datos, archivos de bóveda, logs, backups, temporales, `.env`, dependencias y artefactos de build. Revisa siempre los archivos antes de publicarlos.
#   V a u l t K e y  
 