import io

p = r'src/renderer/components/Access.tsx'
s = io.open(p, encoding='utf-8').read()

old = """      <div className="card">
        <h2>客户端接入</h2>
        <dl className="kv kv-wide">
          <dt>本机地址</dt>
          <dd>
            <span className="copy-text mono" onClick={() => void copy(local)}>
              {local}
            </span>
          </dd>
          {config.settings.allowLan ? (
            <>
              <dt>局域网地址</dt>
              <dd>
                <span className="copy-text mono" onClick={() => void copy(lan)}>
                  {lan}
                </span>
              </dd>
            </>
          ) : null}
        </dl>
      </div>

      <div className="card">
        <div className="access-split">"""
new = """      <div className="card">
        <div className="access-cols">
          <div className="access-cols-left">
            <h2>客户端接入</h2>
            <dl className="kv kv-wide">
              <dt>本机地址</dt>
              <dd>
                <span className="copy-text mono" onClick={() => void copy(local)}>
                  {local}
                </span>
              </dd>
              {config.settings.allowLan ? (
                <>
                  <dt>局域网地址</dt>
                  <dd>
                    <span className="copy-text mono" onClick={() => void copy(lan)}>
                      {lan}
                    </span>
                  </dd>
                </>
              ) : null}
            </dl>
          </div>
          <div className="access-cols-right">
            <div className="access-split">"""
assert old in s
s = s.replace(old, new, 1)

old2 = """          </div>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>接入 Token</h2>"""
new2 = """              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>接入 Token</h2>"""
assert old2 in s
s = s.replace(old2, new2, 1)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('access done')
