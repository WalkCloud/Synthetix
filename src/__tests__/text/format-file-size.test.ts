import { describe, it, expect } from "vitest";
import { formatFileSize } from "@/lib/text/format-file-size";

describe("formatFileSize", () => {
  it("formats bytes", () => {
    expect(formatFileSize(0)).toBe("0B");
    expect(formatFileSize(512)).toBe("512B");
    expect(formatFileSize(1023)).toBe("1023B");
  });

  it("formats kilobytes", () => {
    expect(formatFileSize(1024)).toBe("1.0KB");
    expect(formatFileSize(1536)).toBe("1.5KB");
    expect(formatFileSize(1048575)).toBe("1024.0KB");
  });

  it("formats megabytes", () => {
    expect(formatFileSize(1048576)).toBe("1.0MB");
    expect(formatFileSize(5242880)).toBe("5.0MB");
    expect(formatFileSize(1073741823)).toBe("1024.0MB");
  });

  it("formats gigabytes", () => {
    expect(formatFileSize(1073741824)).toBe("1.0GB");
    expect(formatFileSize(2147483648)).toBe("2.0GB");
  });
});
