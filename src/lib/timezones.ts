export const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
];

export const ALL_TIMEZONES: string[] =
  typeof Intl !== "undefined" && Intl.supportedValuesOf
    ? Intl.supportedValuesOf("timeZone")
    : COMMON_TIMEZONES;

export const OTHER_TIMEZONES = ALL_TIMEZONES.filter(
  (tz) => !COMMON_TIMEZONES.includes(tz),
);
