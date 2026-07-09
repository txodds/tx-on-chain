"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function walk(directory, predicate) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".audit") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute, predicate));
    else if (predicate(absolute)) files.push(absolute);
  }
  return files;
}

function relative(file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function navigationPages(value, pages = []) {
  if (Array.isArray(value)) {
    value.forEach((child) => navigationPages(child, pages));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "pages" && Array.isArray(child)) pages.push(...child);
      else navigationPages(child, pages);
    }
  }
  return pages;
}

function stripFencedCode(markdown) {
  return markdown.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "");
}

test("every docs.json navigation page resolves to a tracked MDX file", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "docs.json"), "utf8"));
  const missing = navigationPages(config.navigation)
    .filter((page) => typeof page === "string" && !/^https?:\/\//.test(page))
    .filter((page) => !fs.existsSync(path.join(root, `${page}.mdx`)));
  assert.deepEqual(missing, []);
});

test("tracked Markdown and MDX code fences are balanced", () => {
  const files = walk(root, (file) => /\.(?:md|mdx)$/i.test(file));
  const unbalanced = files.filter((file) => {
    const fences = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => /^\s*```/.test(line));
    return fences.length % 2 !== 0;
  }).map(relative);
  assert.deepEqual(unbalanced, []);
});

test("root-relative public documentation links resolve or use a declared redirect/API route", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "docs.json"), "utf8"));
  const redirects = new Set((config.redirects || []).map((entry) => entry.source));
  const files = walk(root, (file) => /\.(?:md|mdx)$/i.test(file));
  const missing = [];
  for (const file of files) {
    const markdown = stripFencedCode(fs.readFileSync(file, "utf8"));
    for (const match of markdown.matchAll(/\]\((\/[^)\s#?]+)(?:[?#][^)]*)?\)/g)) {
      const route = match[1].replace(/\/$/, "");
      if (redirects.has(route) || route.startsWith("/api-reference") || route.startsWith("/docs/")) continue;
      const candidates = [
        path.join(root, route.slice(1)),
        path.join(root, `${route.slice(1)}.mdx`),
      ];
      if (!candidates.some(fs.existsSync)) missing.push(`${relative(file)} -> ${route}`);
    }
  }
  assert.deepEqual(missing, []);
});
