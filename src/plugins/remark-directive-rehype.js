import { h } from "hastscript";
import { visit } from "unist-util-visit";

const ADMONITION_TYPES = [
	"note",
	"tip",
	"important",
	"warning",
	"caution",
	"abstract",
	"summary",
	"tldr",
	"info",
	"todo",
	"success",
	"check",
	"done",
	"question",
	"help",
	"faq",
	"attention",
	"failure",
	"missing",
	"fail",
	"danger",
	"error",
	"bug",
	"example",
	"quote",
	"cite",
];

export function parseDirectiveNode() {
	return (tree) => {
		visit(tree, (node) => {
			if (
				node.type === "containerDirective" ||
				node.type === "leafDirective" ||
				node.type === "textDirective"
			) {
				const name = node.name ? node.name.toLowerCase() : "";

				// 检查是否是 Admonition 类型
				// 仅对 containerDirective 进行 Admonition 转换
				if (
					node.type === "containerDirective" &&
					ADMONITION_TYPES.includes(name)
				) {
					const type = name.toUpperCase();

					// 处理 label (自定义标题)
					const firstChild = node.children[0];
					if (firstChild?.data?.directiveLabel) {
						// 如果有 label，注入 [!TYPE] 到 label 开头
						if (
							firstChild.children.length > 0 &&
							firstChild.children[0].type === "text"
						) {
							firstChild.children[0].value = `[!${type}] ${firstChild.children[0].value}`;
						} else {
							firstChild.children.unshift({
								type: "text",
								value: `[!${type}] `,
							});
						}
					} else {
						// 没有 label，插入包含 [!TYPE] 的新段落作为第一个子节点
						node.children.unshift({
							type: "paragraph",
							children: [{ type: "text", value: `[!${type}]` }],
						});
					}

					// 转换为 Blockquote
					node.type = "blockquote";
					node.data = node.data || {};
					node.data.hName = "blockquote";
					// 关键：清除可能存在的 hProperties，防止变为自定义标签
					delete node.data.hProperties;
				} else {
					// 其他 Directive，保留原有逻辑：转换为自定义 HTML 标签
					const data = node.data || {};
					node.data = data;
					node.attributes = node.attributes || {};

					// Lottie 是内联文本指令：`:lottie[kaixin]{}`。
					// 将标签内容转成 data 属性，避免动画初始化前把文件名直接渲染到正文里。
					if (name === "lottie") {
						const label = node.children
							.map((child) => (child.type === "text" ? child.value : ""))
							.join("")
							.trim();
						const configuredName =
							node.attributes.name || node.attributes.src || label;

						if (configuredName) {
							node.attributes["data-lottie-name"] =
								String(configuredName).trim();
							node.attributes["aria-label"] =
								node.attributes["aria-label"] ||
								label ||
								String(configuredName).trim();
							node.attributes.role = "img";
							node.attributes.class = [node.attributes.class, "lottie-emoji"]
								.filter(Boolean)
								.join(" ");
						}

						if (node.attributes.speed) {
							node.attributes["data-lottie-speed"] = node.attributes.speed;
							delete node.attributes.speed;
						}
						if (node.attributes.size) {
							node.attributes["data-lottie-size"] = node.attributes.size;
							delete node.attributes.size;
						}
						delete node.attributes.name;
						delete node.attributes.src;
						node.children = [];
					}

					// Add specific attributes for directive labels
					if (
						node.children.length > 0 &&
						node.children[0].data &&
						node.children[0].data.directiveLabel
					) {
						node.attributes["has-directive-label"] = true;
					}

					const hast = h(node.name, node.attributes);
					data.hName = hast.tagName;
					data.hProperties = hast.properties;
				}
			}
		});
	};
}
