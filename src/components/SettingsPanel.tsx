import type { Sensitivity } from '../input/pitch';
import type { HandFilter } from '../score/model';
import type { MySong, Settings } from '../storage';

interface Props {
  settings: Settings;
  onChange: (next: Settings) => void;
  onClose: () => void;
  onTranscribe: () => void;
  /** MusicXML 파일을 내 악보로 가져온다 */
  onImportXml: (file: File) => void;
  mySongs: MySong[];
  onDeleteMySong: (id: string) => void;
  midi: { supported: boolean; devices: string[] | null; error: string | null; connect: () => void };
  version: string;
}

const HANDS: { value: HandFilter; label: string }[] = [
  { value: 'both', label: '양손' },
  { value: 'right', label: '오른손' },
  { value: 'left', label: '왼손' },
];

const SENSITIVITIES: { value: Sensitivity; label: string }[] = [
  { value: 'low', label: '낮음' },
  { value: 'normal', label: '보통' },
  { value: 'high', label: '높음' },
];

function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="row toggle-row">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** 오른쪽에서 나오는 설정 창. 어느 화면에서든 오른쪽 위 톱니바퀴로 연다 */
export function SettingsPanel({ settings, onChange, onClose, onTranscribe, onImportXml, mySongs, onDeleteMySong, midi, version }: Props) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value });
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <aside className="settings" role="dialog" aria-label="설정" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>설정</h2>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </header>

        <section>
          <h3>연습</h3>
          <div className="row">
            <span>연습할 손</span>
            <Segmented options={HANDS} value={settings.hand} onChange={(v) => set('hand', v)} label="연습할 손" />
          </div>
          <Toggle label="손가락 번호 보기" checked={settings.fingering} onChange={(v) => set('fingering', v)} />
          <Toggle label="다음 음 이름 보기" checked={settings.showHint} onChange={(v) => set('showHint', v)} />
        </section>

        <section>
          <h3>마이크</h3>
          <div className="row">
            <span>
              감도<small>잡음이 많으면 낮음, 작게 치면 높음</small>
            </span>
            <Segmented
              options={SENSITIVITIES}
              value={settings.sensitivity}
              onChange={(v) => set('sensitivity', v)}
              label="마이크 감도"
            />
          </div>
          <Toggle
            label="진단 정보 보기"
            hint="인식이 안 될 때 원인을 찾는 데 써요"
            checked={settings.showDiagnostics}
            onChange={(v) => set('showDiagnostics', v)}
          />
        </section>

        <section>
          <h3>음원으로 악보 만들기</h3>
          <p className="muted">
            피아노 음원 파일이나 유튜브 영상의 구간을 들려주면 AI가 악보로 옮겨요. 만든 악보는 이 기기에만 저장돼요.
          </p>
          <button className="btn primary block" onClick={onTranscribe}>
            악보 만들기
          </button>
          <label className="btn ghost block file-btn">
            MusicXML 파일 가져오기
            <input type="file" accept=".musicxml,.xml" onChange={(e) => e.target.files?.[0] && onImportXml(e.target.files[0])} />
          </label>
          {mySongs.length > 0 && (
            <ul className="my-songs">
              {mySongs.map((s) => (
                <li key={s.id}>
                  <span>
                    {s.title}
                    <small>{new Date(s.createdAt).toLocaleDateString()}</small>
                  </span>
                  <button className="btn ghost small" onClick={() => onDeleteMySong(s.id)}>
                    삭제
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {midi.supported && (
          <section>
            <h3>MIDI 건반</h3>
            {midi.devices ? (
              <p className="muted">{midi.devices.length ? midi.devices.join(', ') : '연결된 장치가 없어요'}</p>
            ) : (
              <button className="btn block" onClick={midi.connect}>
                MIDI 건반 연결
              </button>
            )}
            {midi.error && <p className="error">{midi.error}</p>}
            <Toggle label="친 음을 스피커로 듣기" checked={settings.soundForMidi} onChange={(v) => set('soundForMidi', v)} />
          </section>
        )}

        <footer className="muted">{version}</footer>
      </aside>
    </div>
  );
}
