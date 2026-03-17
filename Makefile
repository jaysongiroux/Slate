SHELL := /bin/zsh

.PHONY: install \
	desktop-up desktop-rebuild-native desktop-lint \
	db-up db-down db-reset db-prisma-generate db-migrate-deploy db-migrate-dev \
	core-dev core-up core-logs core-test core-lint \
	admin-dev admin-up admin-logs admin-lint \
	stack-up stack-logs stack-down \
	backend-db-up backend-db-down backend-db-reset backend-prisma-generate backend-db-migrate backend-test backend-lint backend-up backend-logs

install:
	npm run install:all

desktop-up:
	npm run desktop:up

desktop-rebuild-native:
	npm run desktop:rebuild-native

desktop-lint:
	npm run lint --workspace @slate/desktop

db-up:
	npm run db:up

db-down:
	npm run db:down

db-reset:
	npm run db:reset

db-prisma-generate:
	XDG_CACHE_HOME=/tmp npm run db:prisma:generate

db-migrate-deploy:
	DATABASE_URL='postgresql://slate:slate@localhost:5432/slate?schema=public' npm run db:migrate:deploy

db-migrate-dev:
	@if [ -z "$(NAME)" ]; then echo "Usage: make db-migrate-dev NAME=your_migration_name"; exit 1; fi
	DATABASE_URL='postgresql://slate:slate@localhost:5432/slate?schema=public' npm run db:migrate:dev -- --name $(NAME)

core-dev:
	npm run dev:core-backend

core-up:
	npm run core:up

core-logs:
	npm run core:logs

core-test:
	DATABASE_URL='postgresql://slate:slate@localhost:5432/slate_test?schema=public' npm run db:migrate:deploy
	DATABASE_URL='postgresql://slate:slate@localhost:5432/slate_test?schema=public' npm run test:core

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

# Backward-compatible aliases while command names transition to core/db naming.
backend-db-up: db-up
backend-db-down: db-down
backend-db-reset: db-reset
backend-prisma-generate: db-prisma-generate
backend-db-migrate: db-migrate-deploy
backend-test: core-test
backend-lint: core-lint
backend-up: core-up
backend-logs: core-logs
