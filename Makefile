# bash: available on GitHub Actions (ubuntu) and macOS; zsh is not on ubuntu-latest.
SHELL := /bin/bash

.PHONY: install format \
	desktop-up desktop-rebuild-native desktop-lint desktop-test desktop-build desktop-package desktop-icon \
	db-up db-down db-reset db-prisma-generate db-migrate-deploy db-migrate-dev \
	core-dev core-up core-logs core-test core-lint \
	admin-dev admin-up admin-logs admin-lint \
	stack-up stack-logs stack-down \
	backend-db-up backend-db-down backend-db-reset backend-prisma-generate backend-db-migrate backend-test backend-lint backend-up backend-logs

install:
	npm run install:all

format:
	npm run format

desktop-up:
	npm run desktop:up

desktop-rebuild-native:
	npm run desktop:rebuild-native

desktop-lint:
	npm run lint --workspace @slate/desktop

desktop-test:
	npm run test --workspace @slate/desktop

desktop-build:
	npm run build --workspace @slate/desktop

desktop-package:
	npm run package --workspace @slate/desktop

desktop-icon:
	@echo "Generating icon from apps/desktop/build/icon.png..."
	@test -f apps/desktop/build/icon.png || { echo "Error: apps/desktop/build/icon.png not found"; exit 1; }
	rm -rf apps/desktop/build/icon.iconset
	mkdir -p apps/desktop/build/icon.iconset
	sips -s format png -z 16 16     apps/desktop/build/icon.png --out apps/desktop/build/icon.iconset/icon_16x16.png
	sips -s format png -z 32 32     apps/desktop/build/icon.png --out apps/desktop/build/icon.iconset/icon_16x16@2x.png
	sips -s format png -z 32 32     apps/desktop/build/icon.png --out apps/desktop/build/icon.iconset/icon_32x32.png
	sips -s format png -z 64 64     apps/desktop/build/icon.png --out apps/desktop/build/icon.iconset/icon_32x32@2x.png
	sips -s format png -z 128 128   apps/desktop/build/icon.png --out apps/desktop/build/icon.iconset/icon_128x128.png
	sips -s format png -z 256 256   apps/desktop/build/icon.png --out apps/desktop/build/icon.iconset/icon_128x128@2x.png
	sips -s format png -z 256 256   apps/desktop/build/icon.png --out apps/desktop/build/icon.iconset/icon_256x256.png
	sips -s format png -z 512 512   apps/desktop/build/icon.png --out apps/desktop/build/icon.iconset/icon_256x256@2x.png
	sips -s format png -z 512 512   apps/desktop/build/icon.png --out apps/desktop/build/icon.iconset/icon_512x512.png
	sips -s format png -z 1024 1024 apps/desktop/build/icon.png --out apps/desktop/build/icon.iconset/icon_512x512@2x.png
	iconutil -c icns apps/desktop/build/icon.iconset -o apps/desktop/build/icon.icns
	rm -rf apps/desktop/build/icon.iconset
	@echo "Generated apps/desktop/build/icon.icns"

db-up:
	npm run db:up

db-down:
	npm run db:down

db-reset:
	npm run db:reset

db-prisma-generate:
	XDG_CACHE_HOME=/tmp npm run db:prisma:generate

db-migrate-deploy:
	DATABASE_URL='postgresql://slate:slate@localhost:5435/slate?schema=public' npm run db:migrate:deploy

db-migrate-dev:
	@if [ -z "$(NAME)" ]; then echo "Usage: make db-migrate-dev NAME=your_migration_name"; exit 1; fi
	DATABASE_URL='postgresql://slate:slate@localhost:5435/slate?schema=public' npm run db:migrate:dev -- --name $(NAME)

core-dev:
	npm run dev:core-backend

core-up:
	npm run core:up

core-logs:
	npm run core:logs

core-test:
	DATABASE_URL='postgresql://slate:slate@localhost:5435/slate_test?schema=public' npm run db:migrate:deploy
	DATABASE_URL='postgresql://slate:slate@localhost:5435/slate_test?schema=public' npm run test:core

core-lint:
	npm run lint --workspace @slate/core-backend

admin-dev:
	npm run dev:admin-backend

admin-up:
	npm run admin:up

admin-logs:
	npm run admin:logs

admin-lint:
	npm run lint --workspace @slate/admin-backend

stack-up:
	npm run stack:up

stack-logs:
	npm run stack:logs

stack-down:
	npm run stack:down
