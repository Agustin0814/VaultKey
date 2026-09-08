import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Credential, CredentialView, VaultStatus } from "../types";
export const native = isTauri();
export const api = {
  status: () => invoke<VaultStatus>("status"),
  create: (password: string) => invoke<void>("create_vault", { password }),
  unlock: (password: string) => invoke<void>("unlock_vault", { password }),
  lock: () => invoke<void>("lock_vault"),
  activity: () => invoke<void>("activity"),
  list: (query = "") => invoke<CredentialView[]>("list_credentials", { query }),
  save: (id: string | null, credential: Credential, replacePassword: boolean) =>
    invoke<string>("save_credential", { id, credential, replacePassword }),
  delete: (id: string) => invoke<void>("delete_credential", { id }),
  reveal: (id: string) => invoke<string>("reveal_password", { id }),
  copy: (id: string, field: string) =>
    invoke<void>("copy_field", { id, field }),
  changePassword: (current: string, next: string) =>
    invoke<void>("change_password", { current, new: next }),
  timeout: (seconds: number) => invoke<void>("set_timeout", { seconds }),
};
