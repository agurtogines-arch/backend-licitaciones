console.log(`[analizar-bases-async] Llamando a Claude Sonnet (streaming) jobId=${jobId}...`);

        // ── STREAMING ──────────────────────────────────────────────────────
        // Con max_tokens grande (16000) la respuesta NO-stream supera fácil los
        // 3 min y el AbortSignal.timeout(180000) la mataba con "The user aborted
        // a request.". Con streaming la conexión se mantiene viva recibiendo
        // deltas. En vez de un timeout total, un watchdog aborta SOLO si Claude
        // deja de enviar datos por 90s (cuelgue real).
        const abortCtrl   = new AbortController();
        let   ultimoChunk = Date.now();
        const watchdog    = setInterval(() => {
          if (Date.now() - ultimoChunk > 90000) abortCtrl.abort();
        }, 5000);

        let txtIA = "";
        try {
          const rIA = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type":      "application/json",
              "x-api-key":         ANTHROPIC_KEY,
              "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
              model:      "claude-sonnet-4-6",
              max_tokens: 16000,
              stream:     true,                 // ← la clave
              system:     SYSTEM_PROMPT,
              messages:   [{ role: "user", content: `${META}\n\n--- DOCUMENTOS DE LA LICITACIÓN ---\n\n${textoTotal}` }]
            }),
            signal: abortCtrl.signal
          });

          if (!rIA.ok) {
            const errTxt = await rIA.text().catch(() => "");
            throw new Error(`Anthropic ${rIA.status}: ${errTxt.substring(0, 200)}`);
          }

          // node-fetch v2: rIA.body es un Readable de Node (chunks = Buffer).
          // Parseamos el SSE línea por línea acumulando los text_delta.
          let sseBuf = "", deltas = 0;
          for await (const chunk of rIA.body) {
            ultimoChunk = Date.now();
            sseBuf += chunk.toString("utf8");
            let nl;
            while ((nl = sseBuf.indexOf("\n")) !== -1) {
              const linea = sseBuf.slice(0, nl).trim();
              sseBuf = sseBuf.slice(nl + 1);
              if (!linea.startsWith("data:")) continue;
              const data = linea.slice(5).trim();
              if (!data || data === "[DONE]") continue;
              let evt;
              try { evt = JSON.parse(data); } catch { continue; }
              if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                txtIA += evt.delta.text;
                deltas++;
                // avance real para el polling (en vez de quedar pegado un mensaje)
                if (deltas % 150 === 0) {
                  basesJobs.set(jobId, { ...basesJobs.get(jobId), progreso: `Recibiendo respuesta de Claude — ${txtIA.length} chars...` });
                }
              } else if (evt.type === "error") {
                throw new Error("Stream error: " + JSON.stringify(evt.error || evt));
              }
            }
          }
        } catch (e) {
          if (e.name === "AbortError") throw new Error("Sin respuesta de Claude por 90s (stream colgado) — abortado por watchdog");
          throw e;
        } finally {
          clearInterval(watchdog);
        }

        if (!txtIA) txtIA = "{}";
        const clean = txtIA.replace(/```json|```/g, "").trim();
