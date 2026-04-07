# Google People API Integration — Attendee Autocomplete

## Overview

Integrate with the Google People API to enable autocomplete/search when inviting people to calendar events. Uses the existing Google Calendar OAuth connection — same access token, just an additional scope.

## 1. OAuth Scope Addition

Add to the existing calendar OAuth flow:

- `https://www.googleapis.com/auth/contacts.readonly` — reads the user's contacts for autocomplete
- Or the more limited `https://www.googleapis.com/auth/contacts.other.readonly` — reads "Other contacts" (people the user has interacted with but not explicitly added)

Both are "restricted" scopes requiring Google's OAuth verification. `contacts.readonly` gives the best autocomplete experience since it covers both explicit contacts and directory contacts.

Existing users will need to re-authenticate once to consent to the new scope. The `startCalendarOAuth` flow needs the updated scope list. Handle the case where an existing connection doesn't have the contacts scope yet — autocomplete just won't work until they reconnect.

## 2. API Endpoints

Two endpoints matter:

### `people.searchContacts` — autocomplete-as-you-type

```
GET https://people.googleapis.com/v1/people:searchContacts
  ?query=jane
  &readMask=names,emailAddresses,photos
```

Works for all Google accounts. Debounce at ~300ms.

### `people.searchDirectoryPeople` — org directory (Workspace only)

```
GET https://people.googleapis.com/v1/people:searchDirectoryPeople
  ?query=jane
  &readMask=names,emailAddresses,photos
  &sources=DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE
```

Only works for Google Workspace accounts. Returns 403 for consumer Gmail — handle gracefully.

For best results, call both in parallel and merge/dedupe by email.

## 3. Response Shape

```ts
interface ContactSuggestion {
  name: string; // "Jane Smith"
  email: string; // "jane@example.com"
  photoUrl?: string; // thumbnail URL
  source: "contacts" | "directory";
}
```

## 4. Codebase Changes

| Layer         | File                             | What to do                                                                                                |
| ------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Provider      | `google-calendar.provider.ts`    | Add `searchPeople(accessToken, query)` — hits both endpoints, merges, dedupes by email                    |
| Interface     | `calendar-provider.interface.ts` | Add `searchPeople?(query: string): Promise<ContactSuggestion[]>` (optional, not all providers support it) |
| Service       | `calendar.service.ts`            | Expose `searchPeople(userId, providerId, query)` — decrypts token and delegates                           |
| Controller    | Backend controller               | New endpoint: `POST /calendar/search-people` with `{ connectionId, query }`                               |
| Proto/gRPC    | `slate.proto`                    | Add the RPC if using gRPC, or use the REST controller                                                     |
| Preload + IPC | `preload.mjs` / `main.mjs`       | Expose `searchCalendarPeople(connectionId, query)`                                                        |
| Desktop UI    | Event create/edit form           | Autocomplete input — debounced search, dropdown with name + email + photo                                 |

## 5. Inviting Attendees

The existing `createCalendarEvent` and `updateCalendarEvent` flows already go through Google Calendar's API, which accepts an `attendees` array:

```json
{ "attendees": [{ "email": "jane@example.com" }] }
```

Google handles sending the invite email. Just pass the attendees array through the existing create/update flow.

## 6. Token Reuse

The same OAuth access token from the calendar connection works for the People API — just needs the scope granted at consent time. No separate connection needed.

## Summary

The heaviest lift is the UI autocomplete component. The backend integration is straightforward — one new method on the provider, one new endpoint, same OAuth token. The scope upgrade is the only thing that requires user action (re-consent).
