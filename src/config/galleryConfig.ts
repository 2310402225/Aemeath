import type { GalleryConfig } from "@/types/galleryConfig";

// 相册配置
export const galleryConfig: GalleryConfig = {
	albums: [
		{
			id: "wallpaper-collection",
			name: "壁纸与插画收藏",
			description:
				"一些喜欢的插画与壁纸。部分因画质或比例不适合全屏轮播，在这里完整收藏。",
			tags: ["插画", "壁纸"],
			cover:
				"/gallery/wallpaper-collection/c0d548529c912fdfacbf4fc7179b7f94.webp",
		},
	],

	// 瀑布流最小列宽(px)，浏览器根据容器宽度自动计算列数，默认 240
	// 值越小列数越多，值越大列数越少
	columnWidth: 240,
};
