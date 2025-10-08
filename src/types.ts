export interface Folder {
  folder_id: string;
  project_id: string;
  name: string;
}

export interface File {
  file_id: string;
  folder_id: string | null;
  project_id: string;
  name: string;
  content: string;
}
