import "express-session";

declare module "express-session" {
  interface SessionData {
    adminUser?: {
      id: string;
      email: string;
      title: string;
      accessToken: string;
    };
    adminSession?: {
      accessToken: string;
      expiresAtUnix: number;
      user: {
        id: string;
        email: string;
        displayName: string;
        isAdmin: boolean;
      };
    };
  }
}
