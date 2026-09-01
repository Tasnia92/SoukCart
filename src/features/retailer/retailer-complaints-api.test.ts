import { describe, expect, it } from "vite-plus/test";
import {
  COMPLAINT_FILES_BUCKET,
  fileComplaint,
  loadRetailerComplaints,
  validateComplaintFile,
  type ComplaintGateway,
} from "./retailer-complaints-api.ts";

type Row = {
  id: string;
  subject: string;
  description: string;
  attachment_url: string | null;
  status: string;
  created_at: string;
};

type Capture = {
  select?: string;
  eq?: { column: string; value: string };
  order?: { column: string; ascending: boolean };
  insert?: Record<string, unknown>;
  upload?: { bucket: string; path: string; contentType: string };
  publicUrlPath?: string;
};

function fakeGateway(options: {
  rows?: Row[];
  inserted?: Row | null;
  insertError?: { message: string } | null;
  uploadError?: { message: string } | null;
  queryError?: { message: string } | null;
}): { gateway: ComplaintGateway; capture: Capture } {
  const capture: Capture = {};
  const gateway: ComplaintGateway = {
    from: (_table: string) => ({
      select: (columns: string) => {
        capture.select = columns;
        return {
          eq: (column: string, value: string) => {
            capture.eq = { column, value };
            return {
              order: async (column: string, orderOptions: { ascending: boolean }) => {
                capture.order = { column, ascending: orderOptions.ascending };
                return { data: options.rows ?? [], error: options.queryError ?? null };
              },
            };
          },
        };
      },
      insert: (values: Record<string, unknown>) => {
        capture.insert = values;
        return {
          select: (_columns: string) => ({
            single: async () => ({
              data: options.inserted ?? null,
              error: options.insertError ?? null,
            }),
          }),
        };
      },
    }),
    storage: {
      from: (bucket: string) => ({
        upload: async (
          path: string,
          file: File,
          uploadOptions: { contentType: string; cacheControl: string },
        ) => {
          capture.upload = { bucket, path, contentType: uploadOptions.contentType };
          void file;
          return { error: options.uploadError ?? null };
        },
        getPublicUrl: (path: string) => {
          capture.publicUrlPath = path;
          return { data: { publicUrl: `https://cdn.test/${path}` } };
        },
      }),
    },
  };
  return { gateway, capture };
}

function row(overrides: Partial<Row>): Row {
  return {
    id: "c1",
    subject: "Subject",
    description: "Details",
    attachment_url: null,
    status: "open",
    created_at: "2026-08-30T12:00:00.000Z",
    ...overrides,
  };
}

describe("retailer complaints API", () => {
  it("loads the retailer's own complaints newest first", async () => {
    const { gateway, capture } = fakeGateway({ rows: [row({ id: "c1" }), row({ id: "c2" })] });

    const result = await loadRetailerComplaints("retailer-1", gateway);

    expect(result.map((item) => item.id)).toEqual(["c1", "c2"]);
    expect(capture.select).toContain("attachment_url");
    expect(capture.eq).toEqual({ column: "retailer_id", value: "retailer-1" });
    expect(capture.order).toEqual({ column: "created_at", ascending: false });
  });

  it("throws the query error message", async () => {
    const { gateway } = fakeGateway({ queryError: { message: "row level security" } });
    await expect(loadRetailerComplaints("retailer-1", gateway)).rejects.toThrow(
      "row level security",
    );
  });

  it("accepts images and PDFs but rejects other types and oversized files", () => {
    const image = new File(["x"], "photo.png", { type: "image/png" });
    const pdf = new File(["x"], "doc.pdf", { type: "application/pdf" });
    const text = new File(["x"], "note.txt", { type: "text/plain" });
    const huge = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });

    expect(validateComplaintFile(image)).toBeNull();
    expect(validateComplaintFile(pdf)).toBeNull();
    expect(validateComplaintFile(text)).toBe("Please choose an image or PDF file.");
    expect(validateComplaintFile(huge)).toBe("The file is too large. Please pick one under 5 MB.");
  });

  it("files a complaint without an attachment", async () => {
    const { gateway, capture } = fakeGateway({
      inserted: row({ id: "new", subject: "Broken", description: "Cracked" }),
    });

    const result = await fileComplaint(
      { retailerId: "retailer-1", subject: "Broken", description: "Cracked", file: null },
      gateway,
    );

    expect(result.id).toBe("new");
    expect(capture.upload).toBeUndefined();
    expect(capture.insert).toEqual({
      retailer_id: "retailer-1",
      subject: "Broken",
      description: "Cracked",
      attachment_url: null,
    });
  });

  it("uploads an attachment and stores its public URL", async () => {
    const { gateway, capture } = fakeGateway({
      inserted: row({ id: "with-file", attachment_url: "https://cdn.test/kept" }),
    });
    const file = new File(["x"], "receipt.jpeg", { type: "image/jpeg" });

    await fileComplaint(
      { retailerId: "retailer-9", subject: "S", description: "D", file },
      gateway,
    );

    expect(capture.upload?.bucket).toBe(COMPLAINT_FILES_BUCKET);
    expect(capture.upload?.contentType).toBe("image/jpeg");
    expect(capture.upload?.path.startsWith("retailer-9/")).toBe(true);
    expect(capture.upload?.path.endsWith(".jpg")).toBe(true);
    expect(capture.publicUrlPath).toBe(capture.upload?.path);
    expect(capture.insert?.attachment_url).toBe(`https://cdn.test/${capture.upload?.path}`);
  });

  it("surfaces upload failures before inserting", async () => {
    const { gateway, capture } = fakeGateway({ uploadError: { message: "denied" } });
    const file = new File(["x"], "doc.pdf", { type: "application/pdf" });

    await expect(
      fileComplaint({ retailerId: "r", subject: "S", description: "D", file }, gateway),
    ).rejects.toThrow("The attachment could not be uploaded. denied");
    expect(capture.insert).toBeUndefined();
  });

  it("throws when the insert fails", async () => {
    const { gateway } = fakeGateway({ insertError: { message: "insert failed" } });

    await expect(
      fileComplaint({ retailerId: "r", subject: "S", description: "D", file: null }, gateway),
    ).rejects.toThrow("insert failed");
  });
});
