import { useState } from "react";
import {
  LockKeyhole,
  UnlockKeyhole,
  Plus,
  Pencil,
  Trash2,
  Search,
  Copy,
  Eye,
  EyeOff,
  Mail,
  UserRound,
  Phone,
  KeyRound,
  Link2,
  StickyNote,
  Folder,
  Settings2,
  TriangleAlert,
  Check,
  ShieldCheck,
  LayoutDashboard,
  Star,
  ArrowUpRight,
  ChevronRight,
  X,
  type LucideIcon,
} from "lucide-react";
const icons: Record<string, LucideIcon> = {
  lock: LockKeyhole,
  unlock: UnlockKeyhole,
  add: Plus,
  edit: Pencil,
  delete: Trash2,
  search: Search,
  copy: Copy,
  show: Eye,
  hide: EyeOff,
  email: Mail,
  user: UserRound,
  phone: Phone,
  password: KeyRound,
  link: Link2,
  notes: StickyNote,
  category: Folder,
  settings: Settings2,
  warning: TriangleAlert,
  success: Check,
  security: ShieldCheck,
  vault: LayoutDashboard,
  favorite: Star,
  arrow: ArrowUpRight,
  chevron: ChevronRight,
  close: X,
};
const assets = import.meta.glob("/public/assets/icons/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
export function Icon({ name, size = 19 }: { name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const Fallback = icons[name] || KeyRound;
  const asset = assets[`/public/assets/icons/${name}.svg`];
  return asset && !failed ? (
    <img
      className="asset-icon"
      alt=""
      width={size}
      height={size}
      src={asset}
      onError={() => setFailed(true)}
    />
  ) : (
    <Fallback size={size} strokeWidth={1.8} aria-hidden="true" />
  );
}
const logos = import.meta.glob("/public/assets/images/logo.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
export function Brand() {
  const [failed, setFailed] = useState(false);
  const logo = logos["/public/assets/images/logo.png"];
  return (
    <div className="brand">
      <span className="brand-icon">
        {logo && !failed ? (
          <img src={logo} alt="" onError={() => setFailed(true)} />
        ) : (
          <Icon name="lock" size={26} />
        )}
      </span>
      <span>
        Vault<span className="brand-key">Key</span>
      </span>
    </div>
  );
}
