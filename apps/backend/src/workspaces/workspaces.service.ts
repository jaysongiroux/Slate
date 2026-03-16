import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async bootstrapWorkspace(userId: string, displayName: string) {
    const workspace = await this.prisma.workspace.create({
      data: {
        name: displayName,
        ownerUserId: userId,
        members: {
          create: {
            userId,
            role: "OWNER"
          }
        }
      }
    });

    return {
      id: workspace.id,
      name: workspace.name,
      ownerUserId: workspace.ownerUserId
    };
  }

  async resolveDevSession(clientId: string, deviceName: string) {
    const normalizedClientId = clientId.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-");
    const email = `dev+${normalizedClientId}@local.slate`;
    const displayName = deviceName.trim() || "Slate Local";

    const user = await this.prisma.user.upsert({
      where: { email },
      update: {
        displayName
      },
      create: {
        email,
        displayName
      }
    });

    let membership = await this.prisma.workspaceMember.findFirst({
      where: {
        userId: user.id
      },
      include: {
        workspace: true
      }
    });

    if (!membership) {
      const workspace = await this.prisma.workspace.create({
        data: {
          name: `${displayName} Workspace`,
          ownerUserId: user.id,
          members: {
            create: {
              userId: user.id,
              role: "OWNER"
            }
          }
        }
      });

      membership = {
        id: crypto.randomUUID(),
        workspaceId: workspace.id,
        userId: user.id,
        role: "OWNER",
        createdAt: new Date(),
        workspace
      };
    }

    return {
      clientId,
      userId: user.id,
      workspaceId: membership.workspace.id,
      workspaceName: membership.workspace.name,
      ownerUserId: membership.workspace.ownerUserId
    };
  }
}
