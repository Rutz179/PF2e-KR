import json, argparse, pathlib, sys

# ──────────────────────────────────────────────────────────
#  이름 병기 규칙
# ──────────────────────────────────────────────────────────

def merge_name(kor: str, eng: str, mode: str) -> str:
    if kor == eng:
        return eng
    return {
        "ko-en": f"{kor} ({eng})",
        "en-ko": f"{eng} ({kor})",
        "ko": kor,
        "en": eng,
    }[mode]

# ──────────────────────────────────────────────────────────
#  재귀 병합: ko 구조 유지 + name 필드만 수정
# ──────────────────────────────────────────────────────────

def merge_recursive(kor_obj, eng_obj, mode):
    """kor_obj 구조를 그대로 복사하면서 name 필드를 병기"""
    if isinstance(kor_obj, dict):
        out = {}
        for k, v in kor_obj.items():
            if k == "name":
                kor_name = v
                eng_name = eng_obj.get("name", v) if isinstance(eng_obj, dict) else v
                out["name"] = merge_name(kor_name, eng_name, mode)
            else:
                out[k] = merge_recursive(
                    v,
                    eng_obj.get(k, {}) if isinstance(eng_obj, dict) else {},
                    mode,
                )
        return out

    if isinstance(kor_obj, list):
        eng_list = eng_obj if isinstance(eng_obj, list) else []
        return [
            merge_recursive(kor_item, eng_list[i] if i < len(eng_list) else {}, mode)
            for i, kor_item in enumerate(kor_obj)
        ]
    return kor_obj

# ──────────────────────────────────────────────────────────
#  파일 입출력
# ──────────────────────────────────────────────────────────

def load_json(path: pathlib.Path):
    with path.open(encoding="utf-8") as f:
        return json.load(f)

# ──────────────────────────────────────────────────────────
#  메인 함수
# ──────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="ko/en JSON 병기")
    parser.add_argument("--mode", choices=["ko-en", "en-ko", "ko", "en"], default="ko-en", help="병기 방식")
    args = parser.parse_args()

    base = pathlib.Path(__file__).parent.resolve()
    ko_dir, en_dir, out_dir = base / "ko", base / "en", base / "ko-en"
    out_dir.mkdir(exist_ok=True)

    if not ko_dir.exists() or not en_dir.exists():
        print("❌ ko / en 폴더가 존재하지 않습니다.", file=sys.stderr)
        sys.exit(1)

    processed = skipped = 0

    for ko_file in ko_dir.glob("*.json"):
        en_file = en_dir / ko_file.name
        if not en_file.exists():
            print(f"⚠️  영어 파일 누락: {ko_file.name} — 건너뜀")
            skipped += 1
            continue

        try:
            kor_json = load_json(ko_file)
            eng_json = load_json(en_file)
        except Exception as e:
            print(f"⚠️  JSON 파싱 실패: {ko_file.name}: {e}")
            skipped += 1
            continue

        merged = merge_recursive(kor_json, eng_json, args.mode)
        out_path = out_dir / ko_file.name            # 원본 파일명 그대로 사용
        with out_path.open("w", encoding="utf-8") as f:
            json.dump(merged, f, ensure_ascii=False, indent=2)
        print(f"✅ {out_path.relative_to(base)} 생성")
        processed += 1

    print(f"\n완료: {processed}개 병기, 누락/오류 {skipped}개")


if __name__ == "__main__":
    main()
