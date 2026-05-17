import { describe, it, expect } from "vitest";
import {
  deepClone,
  getByPath,
  updateByPath,
  removeByPath,
  addChildAtPath,
  renumberSections,
  numForPath,
  type OutlineSection,
} from "@/lib/outline-tree";

function makeTree(): OutlineSection[] {
  return [
    { num: "1", title: "Intro", children: [
      { num: "1.1", title: "Background", estimatedWords: 100 },
      { num: "1.2", title: "Motivation" },
    ]},
    { num: "2", title: "Main", children: [
      { num: "2.1", title: "Approach" },
    ]},
    { num: "3", title: "Conclusion" },
  ];
}

describe("deepClone", () => {
  it("deep clones without shared references", () => {
    const original = makeTree();
    const cloned = deepClone(original);
    expect(cloned).toEqual(original);
    cloned[0].title = "Changed";
    expect(original[0].title).toBe("Intro");
  });
});

describe("getByPath", () => {
  it("gets a top-level node", () => {
    const tree = makeTree();
    expect(getByPath(tree, [1])?.title).toBe("Main");
  });

  it("gets a nested node", () => {
    const tree = makeTree();
    expect(getByPath(tree, [0, 0])?.title).toBe("Background");
  });

  it("returns undefined for out-of-bounds path", () => {
    expect(getByPath(makeTree(), [99])).toBeUndefined();
  });

  it("returns undefined for empty path", () => {
    expect(getByPath(makeTree(), [])).toBeUndefined();
  });
});

describe("updateByPath", () => {
  it("updates a node by path", () => {
    const result = updateByPath(makeTree(), [0], (s) => ({ ...s, title: "Updated" }));
    expect(result[0].title).toBe("Updated");
  });

  it("updates a nested node", () => {
    const result = updateByPath(makeTree(), [1, 0], (s) => ({ ...s, title: "New Approach" }));
    expect(result[1].children?.[0].title).toBe("New Approach");
  });

  it("returns same array for empty path", () => {
    const tree = makeTree();
    expect(updateByPath(tree, [], (s) => s)).toBe(tree);
  });
});

describe("removeByPath", () => {
  it("removes a top-level node", () => {
    const result = removeByPath(makeTree(), [0]);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Main");
  });

  it("removes a nested node", () => {
    const result = removeByPath(makeTree(), [0, 1]);
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children?.[0].title).toBe("Background");
  });
});

describe("addChildAtPath", () => {
  it("adds child to top-level when path is empty", () => {
    const result = addChildAtPath(makeTree(), [], { num: "4", title: "New Top", estimatedWords: 50 });
    expect(result).toHaveLength(4);
    expect(result[3].title).toBe("New Top");
  });

  it("adds child to existing node", () => {
    const result = addChildAtPath(makeTree(), [2], { num: "3.1", title: "Sub", estimatedWords: 50 });
    expect(result[2].children).toHaveLength(1);
    expect(result[2].children?.[0].title).toBe("Sub");
  });

  it("adds child to nested node", () => {
    const result = addChildAtPath(makeTree(), [1, 0], { num: "2.1.1", title: "Deep", estimatedWords: 50 });
    expect(result[1].children?.[0].children).toHaveLength(1);
  });
});

describe("renumberSections", () => {
  it("renumbers top-level sections", () => {
    const sections: OutlineSection[] = [
      { num: "5", title: "A" },
      { num: "9", title: "B" },
    ];
    const result = renumberSections(sections);
    expect(result[0].num).toBe("1");
    expect(result[1].num).toBe("2");
  });

  it("renumbers nested sections with dotted notation", () => {
    const result = renumberSections(makeTree());
    expect(result[0].num).toBe("1");
    expect(result[0].children?.[0].num).toBe("1.1");
    expect(result[0].children?.[1].num).toBe("1.2");
    expect(result[1].num).toBe("2");
    expect(result[1].children?.[0].num).toBe("2.1");
  });
});

describe("numForPath", () => {
  it("returns correct number for top-level path", () => {
    expect(numForPath(makeTree(), [2])).toBe("3");
  });

  it("returns dotted number for nested path", () => {
    expect(numForPath(makeTree(), [1, 0])).toBe("2.1");
  });

  it("returns empty string for empty path", () => {
    expect(numForPath(makeTree(), [])).toBe("");
  });
});
