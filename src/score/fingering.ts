/**
 * 왼손(낮은음자리 보표) 손가락 번호를 뒤집는다 (1↔5, 2↔4).
 * 표준은 양손 모두 엄지가 1이라 왼손 도 자리는 도5·솔1이다. 설정에서 "왼손도 낮은 음부터 1"을 고르면
 * 오른손처럼 도1·솔5로 보여 준다. 곡 파일은 그대로 두고 화면에 그릴 때만 바꾼다.
 */
export function mirrorLeftFingering(xml: string): string {
  return xml.replace(/<note>[\s\S]*?<\/note>/g, (note) =>
    /<staff>2<\/staff>/.test(note)
      ? note.replace(/(<fingering[^>]*>)([1-5])(<\/fingering>)/g, (_, open: string, f: string, close: string) => `${open}${6 - Number(f)}${close}`)
      : note,
  );
}
