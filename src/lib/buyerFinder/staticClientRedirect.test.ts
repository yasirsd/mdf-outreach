import { describe, expect, it } from "vitest";
import { extractStaticClientRedirects } from "./staticClientRedirect";

const BASE = "https://company.com/";
const DOMAIN = "company.com";

describe("extractStaticClientRedirects", () => {
  it("recognizes meta refresh to a relative path", () => {
    const html = `<html><head>
      <meta http-equiv="refresh" content="0; url=/home.html">
    </head></html>`;
    expect(extractStaticClientRedirects(html, BASE, DOMAIN)).toEqual([
      "https://company.com/home.html",
    ]);
  });

  it("recognizes meta refresh with delay and absolute https URL", () => {
    const html = `<meta http-equiv="refresh" content="5;url=https://www.company.com/home.html">`;
    expect(extractStaticClientRedirects(html, BASE, DOMAIN)).toEqual([
      "https://www.company.com/home.html",
    ]);
  });

  it("recognizes a direct location.href literal", () => {
    const html = `<script>window.location.href = "/home.html";</script>`;
    expect(extractStaticClientRedirects(html, BASE, DOMAIN)).toEqual([
      "https://company.com/home.html",
    ]);
  });

  it("recognizes location.replace with a quoted same-site URL", () => {
    const html = `<script>location.replace('https://www.company.com/home.html');</script>`;
    expect(extractStaticClientRedirects(html, BASE, DOMAIN)).toEqual([
      "https://www.company.com/home.html",
    ]);
  });

  it("recognizes a same-script quoted-literal variable used as a location sink", () => {
    const html = `<script>
      var redirect = "https://www.company.com/home.html";
      function countDown() {
        if (false) {} else {
          window.location.href = redirect;
        }
      }
    </script>`;
    expect(extractStaticClientRedirects(html, BASE, DOMAIN)).toEqual([
      "https://www.company.com/home.html",
    ]);
  });

  it("does not treat computed or callback JS as a redirect", () => {
    const html = `<script>
      window.location.href = getUrl();
      window.location.href = foo + bar;
      eval("window.location.href='/home.html'");
      document.write("https://company.com/home.html");
      fetch("/home.html");
      const x = userInput;
      location.href = x;
    </script>`;
    expect(extractStaticClientRedirects(html, BASE, DOMAIN)).toEqual([]);
  });

  it("does not follow a concatenated literal assignment", () => {
    const html = `<script>
      const target = "/home" + ".html";
      window.location.href = target;
    </script>`;
    expect(extractStaticClientRedirects(html, BASE, DOMAIN)).toEqual([]);
  });

  it("rejects a cross-site literal before any fetch", () => {
    const html = `<script>window.location.href = "https://evil.example/home.html";</script>`;
    expect(extractStaticClientRedirects(html, BASE, DOMAIN)).toEqual([]);
  });

  it("rejects javascript: and credentials", () => {
    expect(
      extractStaticClientRedirects(
        `<script>location.href = "javascript:alert(1)";</script>`,
        BASE,
        DOMAIN,
      ),
    ).toEqual([]);
    expect(
      extractStaticClientRedirects(
        `<meta http-equiv="refresh" content="0;url=https://user:pass@company.com/home.html">`,
        BASE,
        DOMAIN,
      ),
    ).toEqual([]);
  });

  it("does not harvest arbitrary URLs from script text", () => {
    const html = `<script>
      const help = "https://company.com/home.html";
      console.log(help);
    </script>`;
    expect(extractStaticClientRedirects(html, BASE, DOMAIN)).toEqual([]);
  });
});
