SHELL := /bin/zsh

.PHONY: install desktop-up desktop-rebuild-native desktop-lint backend-db-up backend-db-down backend-db-reset backend-up backend-logs backend-prisma-generate backend-db-migrate backend-db-execute backend-test backend-lint

install:
	npm run install:all

desktop-up:
	npm run desktop:up

desktop-rebuild-native:
	npm run desktop:rebuild-native

desktop-lint:
	npm run lint --workspace @slate/desktop

backend-db-up:
	npm run backend:db:up

backend-db-down:
	npm run backend:db:down

backend-db-reset:
	npm run backend:db:reset

backend-up:
	npm run backend:up

backend-logs:
	npm run backend:logs

backend-prisma-generate:
	XDG_CACHE_HOME=/tmp npm run backend:prisma:generate

backend-db-migrate:
	DATABASE_URL='postgresql://slate:slate@localhost:5432/slate?schema=public' npm run backend:db:migrate

backend-db-execute:
	DATABASE_URL='postgresql://slate:slate@localhost:5432/slate?schema=public' npm run backend:db:execute

backend-test:
	DATABASE_URL='postgresql://slate:slate@localhost:5432/slate?schema=public' npm run test:backend

backend-lint:
	npm run lint --workspace @slate/backend
