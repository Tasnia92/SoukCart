import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { Checkbox } from "./components/ui/checkbox";

describe("scratch markup probe", () => {
  it("prints raw vs radix checkbox markup", () => {
    const raw = renderToStaticMarkup(<input type="checkbox" name="terms" required />);
    // eslint-disable-next-line no-console
    console.log("RAW::" + raw);

    const radix = renderToStaticMarkup(
      <form>
        <Checkbox name="terms" required />
      </form>,
    );
    // eslint-disable-next-line no-console
    console.log("RADIX::" + radix);
    expect(true).toBe(true);
  });
});
