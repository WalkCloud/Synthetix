import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";

export interface StorageAdapter {
  saveOriginal(docId: string, file: File, userId: string): Promise<string>;
  saveMarkdown(docId: string, content: string, userId: string): Promise<string>;
  saveChunk(docId: string, chunkIndex: number, content: string, userId: string): Promise<string>;
  readMarkdown(docId: string, userId: string): Promise<string>;
  readChunk(docId: string, chunkIndex: number, userId: string): Promise<string>;
  deleteDocument(docId: string, userId: string): Promise<void>;
  deleteUserRagData(userId: string): Promise<void>;
  getDocumentDir(docId: string, userId: string): string;
  getImagesDir(docId: string, userId: string): string;
  listImages(docId: string, userId: string): string[];
  readImage(docId: string, userId: string, filename: string): Buffer | null;
  getImagePath(docId: string, userId: string, filename: string): string;
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

  private async ensureDir(dir: string): Promise<void> {
    await fsp.mkdir(dir, { recursive: true });
  }

  async saveOriginal(docId: string, file: File, userId: string): Promise<string> {
    const dir = this.getDocumentDir(docId, userId);
    await this.ensureDir(dir);
    const ext = file.name.split(".").pop() || "bin";
    const filePath = path.join(dir, `original.${ext}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fsp.writeFile(filePath, buffer);
    return filePath;
  }

  async saveMarkdown(docId: string, content: string, userId: string): Promise<string> {
    const dir = this.getDocumentDir(docId, userId);
    await this.ensureDir(dir);
    const filePath = path.join(dir, "full.md");
    await fsp.writeFile(filePath, content, "utf-8");
    return filePath;
  }

  async saveChunk(docId: string, chunkIndex: number, content: string, userId: string): Promise<string> {
    const dir = this.getDocumentDir(docId, userId);
    await this.ensureDir(dir);
    const filePath = path.join(dir, `chunk_${String(chunkIndex).padStart(3, "0")}.md`);
    await fsp.writeFile(filePath, content, "utf-8");
    return filePath;
  }

  async readMarkdown(docId: string, userId: string): Promise<string> {
    const dir = this.getDocumentDir(docId, userId);
    return fsp.readFile(path.join(dir, "full.md"), "utf-8");
  }

  async readChunk(docId: string, chunkIndex: number, userId: string): Promise<string> {
    const dir = this.getDocumentDir(docId, userId);
    return fsp.readFile(
      path.join(dir, `chunk_${String(chunkIndex).padStart(3, "0")}.md`),
      "utf-8"
    );
  }

  async deleteDocument(docId: string, userId: string): Promise<void> {
    const dir = this.getDocumentDir(docId, userId);
    // fsp.rm never blocks the event loop — fs.rmSync held Node's single thread
    // for the whole recursive removal, freezing SSE/requests during bulk deletes.
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }

  async deleteUserRagData(userId: string): Promise<void> {
    const dir = path.join(process.env.RAG_ROOT || "./data/rag", userId);
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    await fsp.mkdir(dir, { recursive: true });
  }

  async deleteDocumentData(docId: string, userId: string): Promise<void> {
    const dir = this.getDocumentDir(docId, userId);
    let entries: string[];
    try {
      entries = await fsp.readdir(dir);
    } catch {
      return; // dir doesn't exist — nothing to do
    }
    await Promise.all(
      entries
        .filter((entry) => !entry.startsWith("original."))
        .map((entry) => fsp.rm(path.join(dir, entry), { recursive: true, force: true }).catch(() => undefined)),
    );
  }

  getImagesDir(docId: string, userId: string): string {
    return path.join(this.getDocumentDir(docId, userId), "images");
  }

  listImages(docId: string, userId: string): string[] {
    const dir = this.getImagesDir(docId, userId);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => {
      const ext = f.split(".").pop()?.toLowerCase() || "";
      return ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tiff"].includes(ext);
    });
  }

  readImage(docId: string, userId: string, filename: string): Buffer | null {
    const filePath = path.join(this.getImagesDir(docId, userId), filename);
    if (!fs.existsSync(filePath)) return null;
    // Prevent path traversal
    const resolved = path.resolve(filePath);
    const imagesDir = path.resolve(this.getImagesDir(docId, userId));
    if (!resolved.startsWith(imagesDir)) return null;
    return fs.readFileSync(filePath);
  }

  getImagePath(docId: string, userId: string, filename: string): string {
    return path.join(this.getImagesDir(docId, userId), filename);
  }
}
