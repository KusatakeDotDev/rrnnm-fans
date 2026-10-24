import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { loadClumpAssets } from "../../src/components/field-renderer";
import type { FieldMesh } from "../../src/lib/field";
import { parseFieldBundle } from "../../src/lib/field-bundle-source";

// 読み解き方は非公開のリポジトリにあるので、ここでは置き換えて、公開側のレンダラーの読み込みだけを見る（RRNNM-44）。
vi.mock("../../src/lib/field-bundle-source", () => ({ parseFieldBundle: vi.fn() }));

const mesh = { parts: [] } as unknown as FieldMesh;
const parse = vi.mocked(parseFieldBundle);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function setup() {
  const bitmap = { width: 1024, height: 1024, close: vi.fn() };
  const texture = {};
  const gl = {
    createTexture: vi.fn(() => texture),
    deleteTexture: vi.fn(),
    bindTexture: vi.fn(),
    texImage2D: vi.fn(),
    generateMipmap: vi.fn(),
    texParameteri: vi.fn(),
    texParameterf: vi.fn(),
    getParameter: vi.fn(() => 16),
    getExtension: vi.fn<() => EXT_texture_filter_anisotropic | null>(() => null),
    isContextLost: vi.fn(() => false),
    getError: vi.fn(() => 0),
    NO_ERROR: 0,
    TEXTURE_2D: 0x0de1,
  };
  const fetchMock = vi.fn(async () => new Response(new Uint8Array(8)));
  const decode = vi.fn(async () => bitmap);
  parse.mockReset();
  parse.mockReturnValue({ mesh, texture: new Uint8Array(4) });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("createImageBitmap", decode);
  return {
    bitmap,
    texture,
    gl,
    fetchMock,
    decode,
    load: () => loadClumpAssets(gl as unknown as WebGL2RenderingContext),
  };
}

describe("素材ロードと GPU リソース", () => {
  it.each([1, 2, 4, 16, null])("異方性フィルタの上限 %s を超えずロードする", async (limit) => {
    const t = setup();
    if (limit !== null) {
      t.gl.getExtension.mockReturnValue({
        TEXTURE_MAX_ANISOTROPY_EXT: 0x84fe,
        MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84ff,
      });
      t.gl.getParameter.mockReturnValue(limit);
    }
    expect((await t.load())?.atlas).toBe(t.texture);
    if (limit === null) {
      expect(t.gl.getParameter).not.toHaveBeenCalled();
      expect(t.gl.texParameterf).not.toHaveBeenCalled();
    } else {
      expect(t.gl.getParameter).toHaveBeenCalledExactlyOnceWith(0x84ff);
      expect(t.gl.texParameterf).toHaveBeenCalledExactlyOnceWith(
        0x0de1,
        0x84fe,
        Math.min(4, limit),
      );
    }
    expect(t.gl.deleteTexture).not.toHaveBeenCalled();
    expect(t.bitmap.close).toHaveBeenCalledOnce();
  });

  it("1つの bin だけ取得し、乗算済みの画像をアップロードして画像を解放する", async () => {
    const t = setup();
    const result = await t.load();
    expect(result?.atlas).toBe(t.texture);
    expect(result?.mesh).toBe(mesh);
    expect(t.fetchMock).toHaveBeenCalledExactlyOnceWith("/field/nemophila.bin", expect.anything());
    expect(parse).toHaveBeenCalledOnce();
    expect(t.decode).toHaveBeenCalledWith(expect.any(Blob), { premultiplyAlpha: "premultiply" });
    expect(t.gl.texImage2D.mock.calls[0]?.at(-1)).toBe(t.bitmap);
    expect(t.bitmap.close).toHaveBeenCalledOnce();
  });

  it.each(["http", "corrupt", "decode", "allocation", "upload", "gpu-error", "dimensions", "lost"])(
    "%s 失敗で代替表示に戻る",
    async (failure) => {
      const t = setup();
      if (failure === "http") t.fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
      if (failure === "corrupt") parse.mockReturnValue(null);
      if (failure === "decode") t.decode.mockRejectedValue(new Error("decode"));
      if (failure === "allocation") t.gl.createTexture.mockReturnValue(null!);
      if (failure === "upload")
        t.gl.texImage2D.mockImplementation(() => {
          throw new Error("upload");
        });
      if (failure === "gpu-error") t.gl.getError.mockReturnValueOnce(0).mockReturnValue(1285);
      if (failure === "dimensions") t.bitmap.width = 1;
      if (failure === "lost") t.gl.isContextLost.mockReturnValue(true);
      expect(await t.load()).toBeNull();
      if (["allocation", "upload", "gpu-error", "dimensions"].includes(failure))
        expect(t.bitmap.close).toHaveBeenCalledOnce();
      if (["upload", "gpu-error"].includes(failure))
        expect(t.gl.deleteTexture).toHaveBeenCalledWith(t.texture);
    },
  );

  it("以前の GL エラーで正常なテクスチャ転送を失敗扱いにしない", async () => {
    const t = setup();
    t.gl.getError.mockReturnValueOnce(1280).mockReturnValueOnce(1282).mockReturnValue(0);
    expect((await t.load())?.atlas).toBe(t.texture);
    expect(t.gl.deleteTexture).not.toHaveBeenCalled();
    expect(t.bitmap.close).toHaveBeenCalledOnce();
  });

  it("画像デコードが期限を超えたら待ちを終え、遅れて届いた画像も解放する", async () => {
    vi.useFakeTimers();
    const t = setup();
    let finish!: (value: typeof t.bitmap) => void;
    t.decode.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const result = t.load();
    await vi.advanceTimersByTimeAsync(4000);
    expect(await result).toBeNull();
    finish(t.bitmap);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.bitmap.close).toHaveBeenCalledOnce();
    expect(t.gl.createTexture).not.toHaveBeenCalled();
  });

  it("デコード中のコンテキスト喪失で GPU に転送しない", async () => {
    const t = setup();
    t.decode.mockImplementation(async () => {
      t.gl.isContextLost.mockReturnValue(true);
      return t.bitmap;
    });
    expect(await t.load()).toBeNull();
    expect(t.bitmap.close).toHaveBeenCalledOnce();
    expect(t.gl.createTexture).not.toHaveBeenCalled();
  });
});
