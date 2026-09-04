import { useState, type MouseEvent } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export const ETRADE_LICENSE_VERIFY_URL = "https://www.etradelicense.gov.bd/ULicVerifyEng";

export function TradeLicenseCopyField({
  value,
  id = "trade-license-number",
  compact = false,
}: {
  value: string;
  id?: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const licence = value.trim();

  const copy = (event?: MouseEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (!licence) return;
    void navigator.clipboard.writeText(licence).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      },
      () => setCopied(false),
    );
  };

  return (
    <Field>
      <FieldLabel htmlFor={id}>Trade licence number</FieldLabel>
      <InputGroup>
        <InputGroupInput id={id} value={licence || "Not provided"} readOnly className="font-mono" />
        <InputGroupAddon align="inline-end">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <InputGroupButton
                  size="icon-xs"
                  aria-label={copied ? "Copied" : "Copy trade licence number"}
                  disabled={!licence}
                  onClick={copy}
                >
                  {copied ? <Check /> : <Copy />}
                  <span className="sr-only">{copied ? "Copied" : "Copy"}</span>
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>{copied ? "Copied" : "Copy trade licence number"}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </InputGroupAddon>
      </InputGroup>
      {compact ? null : (
        <>
          <FieldDescription>
            Copy this number, then open the government site to verify the e-trade licence.
          </FieldDescription>
          <Button asChild variant="outline" size="sm">
            <a href={ETRADE_LICENSE_VERIFY_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink data-icon="inline-start" />
              Verify e-trade number
            </a>
          </Button>
        </>
      )}
    </Field>
  );
}
