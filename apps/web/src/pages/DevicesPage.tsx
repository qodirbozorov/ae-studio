import { useEffect, useState } from "react";
import { api, post } from "../api";
import type { Device } from "../api";

function when(value: string | null): string {
  return value === null ? "—" : new Date(value).toLocaleString("uz-UZ");
}

export function DevicesPage() {
  const [devices, setDevices] = useState<Device[] | null>(null);

  const load = async () => {
    const res = await api<Device[]>("/api/devices");
    setDevices(res.ok ? res.data : []);
  };

  useEffect(() => {
    void load();
  }, []);

  const revoke = async (id: string) => {
    await post(`/api/devices/${id}/revoke`);
    await load();
  };

  return (
    <section className="card">
      <h2>Ulangan qurilmalar</h2>
      {devices === null ? <p>Yuklanmoqda…</p> : null}
      {devices?.length === 0 ? (
        <p className="muted">
          Hali qurilma yo‘q. After Effects’da AE Studio panelini oching va ko‘rsatilgan kodni{" "}
          <a href="/device">shu yerda</a> kiriting.
        </p>
      ) : null}
      <ul className="devices">
        {devices?.map((d) => (
          <li key={d.id} className={d.revoked_at ? "revoked" : undefined}>
            <div>
              <b>{d.name}</b> <span className="muted">{d.os}</span>
              <div className="muted small">
                AE {d.ae_version ?? "?"} · oxirgi aloqa: {when(d.last_seen_at)}
              </div>
            </div>
            {d.revoked_at ? (
              <span className="muted">bekor qilingan</span>
            ) : (
              <button className="secondary" onClick={() => revoke(d.id)}>
                Bekor qilish
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
