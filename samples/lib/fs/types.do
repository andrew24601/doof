export enum IoError {
  NotFound,
  AlreadyExists,
  IsDirectory,
  NotDirectory,
  PermissionDenied,
  InvalidInput,
  Other,
}

export enum EntryKind {
  File,
  Directory,
  Symlink,
  Other,
}

export class DirEntry {
  name: string
  kind: EntryKind
  size: long
}