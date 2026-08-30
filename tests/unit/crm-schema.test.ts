import { describe, it, expect } from "vitest";
import { customerSchema, listFiltersSchema } from "@/features/crm/schema";

describe("customerSchema", () => {
  const base = {
    name: "João Silva",
    email: "Joao@Example.com",
    phone: "(11) 99999-8888",
    whatsapp: "",
    locale: "pt-BR",
    birthDate: "",
    notes: "",
    tags: "vip, mensal",
    preferredEmployeeId: "",
    status: "ACTIVE",
  };
  it("normalises email + phone and parses tags", () => {
    const r = customerSchema.parse(base);
    expect(r.email).toBe("joao@example.com");
    expect(r.phone).toBe("11999998888");
    expect(r.tags).toEqual(["vip", "mensal"]);
  });
  it("rejects a malformed phone", () => {
    expect(customerSchema.safeParse({ ...base, phone: "xx" }).success).toBe(false);
  });
  it("allows empty optional contact fields", () => {
    expect(customerSchema.safeParse({ ...base, email: "", phone: "", tags: "" }).success).toBe(
      true,
    );
  });
});

describe("listFiltersSchema", () => {
  it("coerces pagination and applies defaults", () => {
    const r = listFiltersSchema.parse({ page: "3", pageSize: "50" });
    expect(r.page).toBe(3);
    expect(r.pageSize).toBe(50);
    expect(r.segment).toBe("all");
    expect(r.status).toBe("ALL");
  });
  it("clamps pageSize and rejects bad segment", () => {
    expect(listFiltersSchema.safeParse({ pageSize: "999" }).success).toBe(false);
    expect(listFiltersSchema.safeParse({ segment: "nope" }).success).toBe(false);
  });
});
