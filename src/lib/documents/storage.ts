import fs from "fs";
import path from "path";

export interface StorageAdapter {
  saveOriginal(docId: string, file: File, userId: string): Promise<string>;
  saveMarkdown(docId: string, content: string, userId: string): Promise<string>;
  saveChunk(docId: string, chunkIndex: number, content: string, userId: string): Promise<string>;
  readMarkdown(docId: string, userId: string): Promise<string>;
  readChunk(docId: string, chunkIndex: number, userId: string): Promise<string>;
  deleteDocument(docId: string, userId: string): Promise<void>;
  getDocumentDir(docId: string, userId: string): string;
}

const ROOT = process.env.DOCUMENT_ROOT || "./data/documents";

export class LocalStorageAdapter implements StorageAdapter {
  private root: string;

  constructor(root = ROOT) {
    this.root = root;
  }

  getDocumentDir(docId: string, userId: string): string {
    return path.join(this.root, userId, docId);
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  async saveOriginal(docId: string, file: File, userId: string): Promise<string> {
    const dir = this.getDocumentDir(docId, userId);
    this.ensureDir(dir);
    const ext = file.name.split(".").pop() || "bin";
    const filePath = path.join(dir, `original.${ext}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(filePath, buffer);
    return filePath;
  }

  async saveMarkdown(docId: string, content: string, userId: string): Promise<string> {
    const dir = this.getDocumentDir(docId, userId);
    this.ensureDir(dir);
    const filePath = path.join(dir, "full.md");
    fs.writeFileSync(filePath, content, "utf-8");
    return filePath;
  }

  async saveChunk(docId: string, chunkIndex: number, content: string, userId: string): Promise<string> {
    const dir = this.getDocumentDir(docId, userId);
    this.ensureDir(dir);
    const filePath = path.join(dir, `chunk_${String(chunkIndex).padStart(3, "0")}.md`);
    fs.writeFileSync(filePath, content, "utf-8");
    return filePath;
  }

  async readMarkdown(docId: string, userId: string): Promise<string> {
    const dir = this.getDocumentDir(docId, userId);
    return fs.readFileSync(path.join(dir, "full.md"), "utf-8");
  }

  async readChunk(docId: string, chunkIndex: number, userId: string): Promise<string> {
    const dir = this.getDocumentDir(docId, userId);
    return fs.readFileSync(
      path.join(dir, `chunk_${String(chunkIndex).padStart(3, "0")}.md`),
      "utf-8"
    );
  }

  async deleteDocument(docId: string, userId: string): Promise<void> {
    const dir = this.getDocumentDir(docId, userId);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
  }
}
