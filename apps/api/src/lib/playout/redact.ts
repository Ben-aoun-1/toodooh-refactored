// Strip the value of a `token` query param so a device token in /ws/screen?…&token=<secret> never
// lands in request logs. The key is kept (token=REDACTED) for log readability. Applied app-wide via
// the logger's req serializer (defense-in-depth); the /ws/screen route also sets logLevel:'silent'.
export const redactTokenInUrl = (url: string): string =>
  url.replace(/([?&]token=)[^&#]*/gi, '$1REDACTED');
