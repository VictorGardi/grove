import { useRef, useLayoutEffect } from "react";

const WIPE_MASK =
  "linear-gradient(to right, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 45%, rgba(0,0,0,0) 60%, rgba(0,0,0,0) 100%)";

interface ToolRevealOnMountProps {
  children: React.ReactNode;
  animate: boolean;
}

export function ToolRevealOnMount({ children, animate }: ToolRevealOnMountProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!animate || !el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const maskSupported =
      CSS.supports("mask-image", "linear-gradient(black, transparent)") ||
      CSS.supports("-webkit-mask-image", "linear-gradient(black, transparent)");

    el.style.opacity = "0";
    el.style.transform = "translateX(-0.06em)";
    if (maskSupported) {
      el.style.maskImage = WIPE_MASK;
      el.style.webkitMaskImage = WIPE_MASK;
      el.style.maskSize = "240% 100%";
      el.style.webkitMaskSize = "240% 100%";
      el.style.maskRepeat = "no-repeat";
      el.style.webkitMaskRepeat = "no-repeat";
      el.style.maskPosition = "100% 0%";
      el.style.webkitMaskPosition = "100% 0%";
    }

    let anim: Animation | null = null;
    const frame = requestAnimationFrame(() => {
      const node = rootRef.current;
      if (!node) return;

      const keyframes: Keyframe[] = maskSupported
        ? [
            { opacity: 0, transform: "translateX(-0.06em)", maskPosition: "100% 0%" },
            { opacity: 1, transform: "translateX(0)", maskPosition: "0% 0%" },
          ]
        : [
            { opacity: 0, transform: "translateX(-0.06em)" },
            { opacity: 1, transform: "translateX(0)" },
          ];

      anim = node.animate(keyframes, {
        duration: 500,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "forwards",
      });

      anim.finished
        .catch(() => undefined)
        .finally(() => {
          const t = rootRef.current;
          if (t) {
            t.style.opacity = "";
            t.style.transform = "";
            t.style.maskImage = "";
            t.style.webkitMaskImage = "";
            t.style.maskSize = "";
            t.style.webkitMaskSize = "";
            t.style.maskRepeat = "";
            t.style.webkitMaskRepeat = "";
            t.style.maskPosition = "";
            t.style.webkitMaskPosition = "";
          }
        });
    });

    return () => {
      cancelAnimationFrame(frame);
      anim?.cancel();
    };
  }, [animate]);

  return <div ref={rootRef}>{children}</div>;
}
