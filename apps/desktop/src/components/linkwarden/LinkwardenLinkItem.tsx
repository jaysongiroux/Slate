import { useState } from "react";
import { motion } from "motion/react";
import type { LinkwardenLink } from "@slate/shared";
import { openExternal } from "../../lib/api";
import { LinkRow } from "./LinkRow";
import { LinkDetails } from "./LinkDetails";

const bgTransition = { duration: 0.2, ease: "easeOut" as const };

interface LinkwardenLinkItemProps {
  link: LinkwardenLink;
  instanceId: string;
}

export function LinkwardenLinkItem({ link, instanceId }: LinkwardenLinkItemProps) {
  const [hovered, setHovered] = useState(false);

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
    >
      <LinkRow link={link} />
      <LinkDetails link={link} instanceId={instanceId} visible={hovered} />
    </motion.div>
  );
}
