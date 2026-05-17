import { readFileSync, readdirSync } from "fs";
import { basename } from "path";

const files = readdirSync("E:/tmp/").filter(f => f.endsWith(".docx")).map(f => "E:/tmp/" + f);
if (files.length === 0) { console.log("No file found"); process.exit(1); }

const filePath = files[0];
const fileBuffer = readFileSync(filePath);
const filename = basename(filePath);
console.log("Uploading:", filename, `(${(fileBuffer.length / 1048576).toFixed(1)} MB)`);

const loginRes = await fetch("http://localhost:3000/api/v1/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin123" }),
});
const setCookie = loginRes.headers.get("set-cookie") || "";

const formData = new FormData();
formData.append("file", new Blob([fileBuffer]), filename);

const uploadRes = await fetch("http://localhost:3000/api/v1/documents/upload", {
  method: "POST",
  headers: { Cookie: setCookie },
  body: formData,
});
const data = await uploadRes.json();
console.log("Result:", JSON.stringify(data, null, 2));
