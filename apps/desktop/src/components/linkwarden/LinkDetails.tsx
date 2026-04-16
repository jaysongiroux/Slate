import { useEffect, useState } from "react";
import { motion } from "motion/react";
import type { LinkwardenLink } from "@slate/shared";
import { resolveLinkwardenPreviewUrl } from "../../lib/api";

const transition = { duration: 0.3, ease: [0.4, 0, 0.2, 1] as const };

interface LinkDetailsProps {
  link: LinkwardenLink;
  instanceId: string;
  visible: boolean;
}

export function LinkDetails({ link, instanceId, visible }: LinkDetailsProps) {
  const hasDescription = !!link.description;
  const hasTags = link.tags.length > 0;
  const hasImage = !!link.image;
  const [imgSrc, setImgSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!hasImage || !instanceId) return;
    void resolveLinkwardenPreviewUrl({ instanceId, linkId: link.id }).then((url) => {
      if (url) setImgSrc(url);
    });
  }, [hasImage, instanceId, link.id]);

  if (!hasDescription && !hasTags && !hasImage) return null;

  return (
    <motion.div
      animate={{ height: visible ? "auto" : 0, opacity: visible ? 1 : 0 }}
      initial={false}
      transition={transition}
      className="overflow-hidden"
    >
      <div className="flex items-end gap-2.5 pb-1.5">
        {/* Spacer to align with dot */}
        <div className="size-[5px] shrink-0" />

        <div className="min-w-0 flex-1">
          {hasDescription && (
            <p className="m-0 line-clamp-2 text-[0.7rem] leading-snug text-foreground/30">
              {link.description}
            </p>
          )}
          {hasTags && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {link.tags.map((tag) => (
                <span
                  key={tag.id}
                  className="rounded-lg border border-white/[0.06] bg-white/[0.04] px-1.5 py-px text-[0.6rem] text-foreground/35"
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {imgSrc && (
          <img
            src={imgSrc}
            alt=""
            className="h-[56px] w-[72px] shrink-0 rounded border border-white/[0.06] bg-white/[0.03] object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        )}
      </div>
    </motion.div>
  );
}
