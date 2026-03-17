import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { SettingsModule } from "../settings/settings.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthSessionService } from "./auth-session.service";

@Module({
  imports: [
    SettingsModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>("JWT_SECRET", "local-dev-secret"),
        signOptions: { expiresIn: "1h" }
      })
    })
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthSessionService],
  exports: [AuthService, AuthSessionService]
})
export class AuthModule {}
