import fs from "fs";
import path from "path";

const filePath = "E:/tmp/【标准】ACP3.8.1全栈云平台技术方案.220721.docx";
if (!fs.existsSync(filePath)) { console.log("File not found"); process.exit(1); }

const filename = path.basename(filePath);
const fileContent = fs.readFileSync(filePath);

const boundary = "----Boundary" + Date.now();
const parts = [
  `--${boundary}`,
  `Content-Disposition: form-data; name="file"; filename="${filename}"`,
  `Content-Type: application/octet-stream`,
  ``,
  fileContent.toString("binary"),
  `--${boundary}--`,
];
const body = Buffer.from(parts.join("\r\n"), "binary");

const res = await fetch("http://localhost:3000/api/v1/documents/upload", {
  method: "POST",
  headers: {
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
  },
  body,
});
const data = await res.json();
console.log("Upload status:", res.status);
console.log(JSON.stringify(data, null, 2));
