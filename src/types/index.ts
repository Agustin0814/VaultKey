export const methods = [
  "Email + Password",
  "Username + Password",
  "Phone + Password",
  "Google",
  "Facebook",
  "Apple",
  "Microsoft",
  "Linked Account",
  "Custom",
] as const;
export interface Credential {
  service: string;
  accessMethod: string;
  email: string;
  username: string;
  phone: string;
  password: string;
  linkedAccount: string | null;
  url: string;
  notes: string;
  category: string;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}
export interface CredentialView extends Credential {
  id: string;
  hasPassword: boolean;
}
export interface VaultStatus {
  exists: boolean;
  unlocked: boolean;
  timeoutSeconds: number;
}
export const emptyCredential = (): Credential => ({
  service: "",
  accessMethod: methods[0],
  email: "",
  username: "",
  phone: "",
  password: "",
  linkedAccount: null,
  url: "",
  notes: "",
  category: "",
  favorite: false,
  createdAt: 0,
  updatedAt: 0,
});
