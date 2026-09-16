/* Create a Chinese post with the frontmatter required by the content schema. */

import fs from "node:fs";
import path from "node:path";

function getDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error(`缺少文件名
用法: pnpm new-post -- <文件名>`);
  process.exit(1);
}

let fileName = args[0];

// Add .md extension if not present
const fileExtensionRegex = /\.(md|mdx)$/i
if (!fileExtensionRegex.test(fileName)) {
  fileName += ".md";
}

const targetDir = "./src/content/posts/";
const fullPath = path.join(targetDir, fileName);

if (fs.existsSync(fullPath)) {
  console.error(`文件已存在: ${fullPath}`);
  process.exit(1);
}

// recursive mode creates multi-level directories
const dirPath = path.dirname(fullPath);
if (!fs.existsSync(dirPath)) {
  fs.mkdirSync(dirPath, { recursive: true });
}

const content = `---
title: ${args[0]}
published: ${getDate()}
updated: ${getDate()}
topic: 学习记录
description: ''
tags: []
category: ''
image: ''
draft: true
lang: zh_CN
---

## 要解决的问题

## 核心内容

## 复现步骤

## 结果与局限
`;

fs.writeFileSync(path.join(targetDir, fileName), content);

console.log(`已创建: ${fullPath}`);
