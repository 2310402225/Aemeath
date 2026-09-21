import { coverImageConfig } from "../config/coverImageConfig";
import { siteConfig } from "../config/siteConfig";
import type { ImageFormat } from "../types/config";

const { randomCoverImage } = coverImageConfig;

/**
 * 根据seed生成确定性hash值
 */
function getSeedHash(seed?: string): number {
	return seed
		? Math.abs(
				seed.split("").reduce((acc, char) => {
					return ((acc << 5) - acc + char.charCodeAt(0)) | 0;
				}, 0),
			)
		: 0;
}

/**
 * 为API URL添加seed参数，确保每篇文章获取不同图片
 */
function appendSeedParam(apiUrl: string, hash: number): string {
	if (hash === 0) return apiUrl;
	const separator = apiUrl.includes("?") ? "&" : "?";
	return `${apiUrl}${separator}v=${hash}`;
}

/**
 * 处理文章封面图
 * 当image字段为"api"时，返回第一个API的URL（客户端会按顺序尝试所有API）
 * @param image - 文章frontmatter中的image字段值
 * @param seed - 用于生成唯一URL的种子（文章id或slug）
 */
export function processCoverImageSync(
	image: string | undefined,
	seed?: string,
): string {
	if (!image || image === "") {
		return "";
	}

	if (image !== "api") {
		return image;
	}

	if (
		!randomCoverImage.enable ||
		!randomCoverImage.apis ||
		randomCoverImage.apis.length === 0
	) {
		return "";
	}

	// 始终使用第一个API，失败时由客户端按顺序尝试后续API
	const hash = getSeedHash(seed);
	return appendSeedParam(randomCoverImage.apis[0], hash);
}

/**
 * 获取所有随机封面图API URL列表（带seed参数）
 * 用于客户端按顺序尝试，第一个成功即使用，全部失败则显示回退图片
 * @param image - 文章frontmatter中的image字段值
 * @param seed - 用于生成唯一URL的种子（文章id或slug）
 */
export function getApiUrlList(
	image: string | undefined,
	seed?: string,
): string[] {
	if (image !== "api" || !randomCoverImage.enable || !randomCoverImage.apis) {
		return [];
	}

	const hash = getSeedHash(seed);
	return randomCoverImage.apis.map((api) => appendSeedParam(api, hash));
}

/**
 * 获取图片优化格式配置
 */
export function getImageFormats(): ImageFormat[] {
	const formatConfig = siteConfig.imageOptimization?.formats ?? "both";
	switch (formatConfig) {
		case "avif":
			return ["avif"];
		case "webp":
			return ["webp"];
		default:
			return ["avif", "webp"];
	}
}

/**
 * 获取图片优化质量配置
 */
export function getImageQuality(): number {
	return siteConfig.imageOptimization?.quality ?? 80;
}

/**
 * 获取图片回退格式
 */
export function getFallbackFormat(): "avif" | "webp" {
	const formatConfig = siteConfig.imageOptimization?.formats ?? "both";
	return formatConfig === "avif" ? "avif" : "webp";
}

/**
 * 读取 public/ 下静态图片的真实像素尺寸。
 *
 * public/ 里的图是「同名覆盖」的固定文件名，没走 astro:assets，
 * 所以没有 ImageMetadata 可用；而缺少 width/height 的 <img> 会在图片解码后
 * 撑开容器造成瀑布流重排（CLS）。构建期用 sharp 读一次头信息并按路径缓存。
 *
 * 只处理站内绝对路径（以 "/" 开头），远程 URL / data: 直接返回 null。
 */
const publicImageSizeCache = new Map<
	string,
	{ width: number; height: number } | null
>();

export async function readPublicImageSize(
	src: string,
): Promise<{ width: number; height: number } | null> {
	if (!src?.startsWith("/")) return null;

	const cached = publicImageSizeCache.get(src);
	if (cached !== undefined) return cached;

	let result: { width: number; height: number } | null = null;
	try {
		const [{ promises: fs }, nodePath, { default: sharp }] = await Promise.all([
			import("node:fs"),
			import("node:path"),
			import("sharp"),
		]);
		const filePath = nodePath.join(
			process.cwd(),
			"public",
			decodeURIComponent(src).replace(/^\/+/, ""),
		);
		const buffer = await fs.readFile(filePath);
		const meta = await sharp(buffer).metadata();
		if (meta.width && meta.height) {
			result = { width: meta.width, height: meta.height };
		}
	} catch {
		// 文件不存在或不是图片：静默跳过，页面上退回「无尺寸」的普通 img
		result = null;
	}

	publicImageSizeCache.set(src, result);
	return result;
}

/**
 * 检查是否需要为图片添加 referrerpolicy="no-referrer" 以解决防盗链 403 问题
 */
export function shouldAddNoReferrer(urlStr: string): boolean {
	if (!urlStr.startsWith("http")) return false;
	const domains = siteConfig.imageOptimization?.noReferrerDomains || [];
	if (domains.length === 0) return false;
	try {
		const hostname = new URL(urlStr).hostname;
		return domains.some((pattern) => {
			const regexPattern = pattern.replace(/\./g, "\\.").replace(/\*/g, ".*");
			return new RegExp(`^${regexPattern}$`).test(hostname);
		});
	} catch {
		return false;
	}
}
