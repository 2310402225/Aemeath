export type ResourceCategory = "工具" | "课程" | "论文" | "书单" | "数据集" | "其他";

export interface ResourceItem {
	name: string;
	purpose: string;
	reason: string;
	audience: string;
	alternative: string;
	tags: string[];
	url: string;
	category: ResourceCategory;
}

// 资源条目按“名称、用途、推荐理由、适用人群、替代方案、标签、原始链接”维护。
export const resources: ResourceItem[] = [];

export const resourceCategories: ResourceCategory[] = [
	"工具",
	"课程",
	"论文",
	"书单",
	"数据集",
	"其他",
];
