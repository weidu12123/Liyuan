/**
 * 品牌 Logo：高分屏用大图，失败时用 CSS 树形占位（弱网不裂图）。
 */

type BrandLogoProps = {
	/** 显示边长（CSS px） */
	size: number;
	className?: string;
	alt?: string;
};

/** 按显示尺寸挑合适源：至少 2× 设备像素，避免手机发糊 */
function pickSrc(displayPx: number): { src: string; srcSet?: string } {
	const need = displayPx * 2;
	if (need <= 64) {
		return { src: "/logo-64.png", srcSet: "/logo-64.png 1x, /logo-128.png 2x, /logo-256.png 3x" };
	}
	if (need <= 128) {
		return { src: "/logo-128.png", srcSet: "/logo-128.png 1x, /logo-256.png 2x, /logo-512.png 3x" };
	}
	if (need <= 256) {
		return { src: "/logo-256.png", srcSet: "/logo-256.png 1x, /logo-512.png 2x" };
	}
	return { src: "/logo-512.png", srcSet: "/logo-512.png 1x, /logo.png 2x" };
}

export function BrandLogo({ size, className = "", alt = "" }: BrandLogoProps) {
	const { src, srcSet } = pickSrc(size);
	return (
		<img
			className={`brand-logo-img ${className}`.trim()}
			src={src}
			srcSet={srcSet}
			sizes={`${size}px`}
			width={size}
			height={size}
			alt={alt}
			decoding="async"
			// 弱网裂图：换成可绘制的占位，避免破图图标
			onError={(e) => {
				const el = e.currentTarget;
				el.onerror = null;
				el.removeAttribute("srcset");
				el.src =
					"data:image/svg+xml," +
					encodeURIComponent(
						`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">` +
							`<rect width="64" height="64" rx="14" fill="#f7f4f0"/>` +
							`<path d="M32 10c-1 8-8 12-8 20 0 6 4 10 8 12 4-2 8-6 8-12 0-8-7-12-8-20z" fill="#3d3833"/>` +
							`<path d="M22 42c4 6 10 8 10 8s6-2 10-8" stroke="#bc4123" stroke-width="2.5" stroke-linecap="round"/>` +
							`</svg>`,
					);
			}}
		/>
	);
}
