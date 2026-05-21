import { describe, expect, it } from "vitest";
import { permissionPolicy } from "../src/permission-policy.js";

describe("permissionPolicy", () => {
  it("allows read tools under read_only", () => {
    expect(permissionPolicy("read_only", "read_file")).toBe("allow");
    expect(permissionPolicy("read_only", "view")).toBe("allow");
    expect(permissionPolicy("read_only", "cat")).toBe("allow");
  });

  it("denies non-read tools under read_only", () => {
    expect(permissionPolicy("read_only", "write_file")).toBe("deny");
    expect(permissionPolicy("read_only", "bash_command")).toBe("deny");
    expect(permissionPolicy("read_only", "url")).toBe("deny");
  });

  it("allows read and url tools under limited_write", () => {
    expect(permissionPolicy("limited_write", "read_file")).toBe("allow");
    expect(permissionPolicy("limited_write", "open_url")).toBe("allow");
  });

  it("denies shell and write tools under limited_write", () => {
    expect(permissionPolicy("limited_write", "write_file")).toBe("deny");
    expect(permissionPolicy("limited_write", "bash_command")).toBe("deny");
  });

  it("allows all tools under full_access", () => {
    expect(permissionPolicy("full_access", "write_file")).toBe("allow");
    expect(permissionPolicy("full_access", "bash_command")).toBe("allow");
    expect(permissionPolicy("full_access", "read_file")).toBe("allow");
  });

  it("allows all tools under default", () => {
    expect(permissionPolicy("default", "write_file")).toBe("allow");
  });

  it("allows all tools for unknown levels (default case)", () => {
    expect(permissionPolicy("unknown", "read_file")).toBe("allow");
    expect(permissionPolicy("unknown", "write_file")).toBe("allow");
  });

  it("allows all tools when level is empty (default case)", () => {
    expect(permissionPolicy("", "read_file")).toBe("allow");
    expect(permissionPolicy("", "write_file")).toBe("allow");
  });
});
