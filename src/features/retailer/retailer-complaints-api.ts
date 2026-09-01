import { supabase } from "../../supabase.ts";

export const COMPLAINT_FILES_BUCKET = "complaint-files";
export const MAX_COMPLAINT_FILE_BYTES = 5 * 1024 * 1024;

const COMPLAINT_SELECT = "id, subject, description, attachment_url, status, created_at";

export type RetailerComplaint = {
  id: string;
  subject: string;
  description: string;
  attachment_url: string | null;
  status: "open" | "resolved";
  created_at: string;
};

type ComplaintRow = {
  id: string;
  subject: string;
  description: string;
  attachment_url: string | null;
  status: string;
  created_at: string;
};

type QueryResult = { data: ComplaintRow[] | null; error: { message: string } | null };
type SingleResult = { data: ComplaintRow | null; error: { message: string } | null };

export type ComplaintGateway = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => { order: (column: string, options: { ascending: boolean }) => Promise<QueryResult> };
    };
    insert: (values: Record<string, unknown>) => {
      select: (columns: string) => { single: () => Promise<SingleResult> };
    };
  };
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        file: File,
        options: { contentType: string; cacheControl: string },
      ) => Promise<{ error: { message: string } | null }>;
      getPublicUrl: (path: string) => { data: { publicUrl: string } };
    };
  };
};

const complaintGateway = supabase as unknown as ComplaintGateway;

function normalize(row: ComplaintRow): RetailerComplaint {
  return {
    id: row.id,
    subject: row.subject,
    description: row.description,
    attachment_url: row.attachment_url,
    status: row.status as RetailerComplaint["status"],
    created_at: row.created_at,
  };
}

export async function loadRetailerComplaints(
  retailerId: string,
  gateway: ComplaintGateway = complaintGateway,
): Promise<RetailerComplaint[]> {
  const { data, error } = await gateway
    .from("complaints")
    .select(COMPLAINT_SELECT)
    .eq("retailer_id", retailerId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(normalize);
}

// Mirrors the legacy MIME/size guard. Returns an error message or null when acceptable.
export function validateComplaintFile(file: File): string | null {
  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf";
  if (!isImage && !isPdf) return "Please choose an image or PDF file.";
  if (file.size > MAX_COMPLAINT_FILE_BYTES) {
    return "The file is too large. Please pick one under 5 MB.";
  }
  return null;
}

function fileExtension(file: File): string {
  if (file.type === "application/pdf") return "pdf";
  return file.type.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
}

export type FileComplaintInput = {
  retailerId: string;
  subject: string;
  description: string;
  file: File | null;
};

export async function fileComplaint(
  { retailerId, subject, description, file }: FileComplaintInput,
  gateway: ComplaintGateway = complaintGateway,
): Promise<RetailerComplaint> {
  let attachmentUrl: string | null = null;
  if (file) {
    const objectPath = `${retailerId}/${crypto.randomUUID()}.${fileExtension(file)}`;
    const { error: uploadError } = await gateway.storage
      .from(COMPLAINT_FILES_BUCKET)
      .upload(objectPath, file, { contentType: file.type, cacheControl: "3600" });
    if (uploadError) {
      throw new Error(`The attachment could not be uploaded. ${uploadError.message}`);
    }
    attachmentUrl = gateway.storage.from(COMPLAINT_FILES_BUCKET).getPublicUrl(objectPath)
      .data.publicUrl;
  }

  const { data, error } = await gateway
    .from("complaints")
    .insert({ retailer_id: retailerId, subject, description, attachment_url: attachmentUrl })
    .select(COMPLAINT_SELECT)
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "The complaint could not be filed.");
  }
  return normalize(data);
}
