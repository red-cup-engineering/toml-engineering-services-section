import { parseCivilDate } from "@red-cup-engineering/time-data-engine";

const DAY = /^\d{4}-\d{2}-\d{2}$/u;
const CLOCK = /^(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/iu;

function offsetMinutes(offset) {
  if (offset === "Z") return 0;
  const hours = Number(offset.slice(1, 3));
  const minutes = Number(offset.slice(4));
  return hours > 23 || minutes > 59 ? NaN : (offset[0] === "-" ? -1 : 1) * (60 * hours + minutes);
}

function readDate(value) {
  if (value instanceof Date) value = Number.isFinite(value.getTime()) ? Date.prototype.toISOString.call(value) : "";
  if (typeof value !== "string") return {};
  const split = /^(\d{4}-\d{2}-\d{2})[Tt ](.*)$/u.exec(value);
  const date = split?.[1] ?? (DAY.test(value) ? value : undefined);
  if (date !== undefined) {
    if (parseCivilDate(date) === null) return {};
    if (!split) return { kind: "date", utc: Date.parse(date) };
  }

  const clock = CLOCK.exec(split?.[2] ?? value);
  if (clock === null || Number(clock[1]) > 23 || Number(clock[2]) > 59 || Number(clock[3]) > 59) return {};
  const [, hours, minutes, seconds = "00", fractional = "", writtenOffset] = clock;
  if (writtenOffset !== undefined && date === undefined) return {};
  const offset = writtenOffset?.toUpperCase();
  const millis = fractional.slice(1, 4).padEnd(3, "0");
  const utc = Date.parse(`${date ?? "0000-01-01"}T${hours}:${minutes}:${seconds}.${millis}${offset ?? "Z"}`);
  if (!Number.isFinite(utc)) return {};
  return { kind: offset ? "offset" : date ? "datetime" : "time", utc, offset };
}

/** A TOML calendar, clock, local datetime or offset datetime at millisecond precision. */
export class TomlDate extends Date {
  #kind;
  #offset;

  constructor(value) {
    const { kind, offset, utc = NaN } = readDate(value);
    super(utc);
    this.#kind = kind;
    this.#offset = offset;
  }

  isDateTime() { return this.#kind === "datetime" || this.#kind === "offset"; }
  isLocal() { return this.#kind !== "offset"; }
  isDate() { return this.#kind === "date"; }
  isTime() { return this.#kind === "time"; }
  isValid() { return this.#kind !== undefined && Number.isFinite(this.getTime()); }

  toISOString() {
    if (!this.isValid()) throw new RangeError("Invalid time value");
    if (this.#kind === "offset") {
      const local = new Date(this.getTime() + offsetMinutes(this.#offset) * 60_000).toISOString();
      return local.slice(0, -1) + this.#offset;
    }
    const utc = super.toISOString();
    if (this.isDate()) return utc.split("T")[0];
    if (this.isTime()) return utc.split("T")[1].slice(0, -1);
    return utc.slice(0, -1);
  }

  static wrapAsOffsetDateTime(date, offset = "Z") {
    if (!/^(?:Z|[+-]\d{2}:\d{2})$/u.test(offset)) return new TomlDate("");
    const local = new Date(date.getTime() + offsetMinutes(offset) * 60_000);
    return new TomlDate(Number.isFinite(local.getTime()) ? local.toISOString().slice(0, -1) + offset : "");
  }

  static wrapAsLocalDateTime(date) {
    return new TomlDate(Number.isFinite(date.getTime()) ? Date.prototype.toISOString.call(date).slice(0, -1) : "");
  }

  static wrapAsLocalDate(date) {
    return new TomlDate(Number.isFinite(date.getTime()) ? Date.prototype.toISOString.call(date).split("T")[0] : "");
  }

  static wrapAsLocalTime(date) {
    return new TomlDate(Number.isFinite(date.getTime()) ? Date.prototype.toISOString.call(date).split("T")[1].slice(0, -1) : "");
  }
}
