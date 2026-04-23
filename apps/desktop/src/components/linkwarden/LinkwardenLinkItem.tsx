import { useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import type { LinkwardenLink } from "@slate/shared";
import { openExternal, showContextMenu } from "../../lib/api";
import type { ContextMenuItem as NativeMenuItem } from "../../lib/api";
import { LinkRow } from "./LinkRow";
import { LinkDetails } from "./LinkDetails";

const bgTransition = { duration: 0.2, ease: "easeOut" as const };

interface LinkwardenLinkItemProps {
  link: LinkwardenLink;
  instanceId: string;
}

export function LinkwardenLinkItem({ link, instanceId }: LinkwardenLinkItemProps) {
  const [hovered, setHovered] = useState(false);

  async function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const items: NativeMenuItem[] = [
      { id: "open", label: "Open" },
      { type: "separator", id: "sep-open", label: "" },
      { id: "copy-link", label: "Copy Link" },
    ];
    const selected = await showContextMenu(items);
    if (selected === "open") {
      void openExternal(link.url);
    } else if (selected === "copy-link") {
      try {
        await navigator.clipboard.writeText(link.url);
        toast.success("Link copied to clipboard.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not copy link.");
      }
    }
  }

  return (
    <motion.div
      className="min-w-0 cursor-pointer rounded-md px-2.5"
      style={{ border: "1px solid transparent", overflow: "hidden", maxWidth: "100%" }}
      animate={{
        backgroundColor: hovered ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0)",
        borderColor: hovered ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0)",
      }}
      transition={bgTransition}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      onClick={() => void openExternal(link.url)}
      onContextMenu={(e) => void handleContextMenu(e)}
    >
      <LinkRow link={link} />
      <LinkDetails link={link} instanceId={instanceId} visible={hovered} />
    </motion.div>
  );
}
