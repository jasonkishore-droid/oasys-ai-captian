# assets

Files the app saves while it runs.

- `waiters/` holds the waiters' profile pictures (small square JPEGs). A picture is saved here when a waiter sets or
  changes it on the waiter screen, and shown on the guest's tablet when that waiter is on the way. They are served at
  `/assets/waiters/<file>`. The pictures themselves are not committed to git (see `.gitignore`): they are people's photos.
