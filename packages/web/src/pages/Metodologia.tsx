export function Metodologia() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Metodologia</h1>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">1. Sobre o projeto</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          Este painel é um projeto independente de código aberto que monitora o sentimento em redes
          sociais e mídias digitais sobre os candidatos à presidência do Brasil nas eleições de 2026.
          Não é afiliado a nenhum candidato, partido político ou campanha eleitoral. Os dados são
          apresentados de forma informativa, sem intenção de influenciar votos ou opiniões.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">2. Fontes de dados</h2>
        <p className="text-sm text-gray-600 mb-2">Dados são coletados continuamente das seguintes plataformas:</p>
        <ul className="text-sm text-gray-600 space-y-1.5 list-none">
          <li>
            <span className="font-medium">Reddit</span> — subreddits brasil, brasilivre, PoliticaBR,
            BrasildoB (a cada 1 min)
          </li>
          <li>
            <span className="font-medium">NewsAPI</span> — portais de notícias em português (a cada 1 min)
          </li>
          <li>
            <span className="font-medium">Threads</span> — via Apify, termos de busca em português
            (a cada 5 min)
          </li>
          <li>
            <span className="font-medium">X/Twitter</span> — via Apify, filtro <code className="bg-gray-100 px-1 rounded">lang:pt</code> (a cada 5 min)
          </li>
          <li>
            <span className="font-medium">YouTube</span> — comentários de vídeos relacionados via
            YouTube Data API v3 (a cada 5 min)
          </li>
        </ul>
        <p className="text-sm text-gray-600 mt-3">
          Apenas conteúdo em português é processado (confiança ≥ 70% via Amazon Comprehend).
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">3. Como o sentimento é calculado</h2>
        <p className="text-sm text-gray-600 leading-relaxed mb-3">
          O sentimento é detectado pelo Amazon Comprehend, serviço de processamento de linguagem
          natural da AWS treinado em português. Cada publicação é classificada como{' '}
          <em>positiva</em>, <em>negativa</em> ou <em>neutra</em> em relação ao candidato mencionado.
        </p>
        <p className="text-sm text-gray-600 leading-relaxed">
          O score exibido é calculado como:{' '}
          <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">
            score = round(menções_positivas / total × 100)
          </code>
          {'. '}
          Representa a percentagem de menções positivas na última hora (janela rolante de 1 hora).
          Publicações que mencionam mais de um candidato são contabilizadas para todos os candidatos
          mencionados.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">4. Desinformação</h2>
        <p className="text-sm text-gray-600 leading-relaxed mb-3">
          Publicações de redes sociais (exceto notícias) são analisadas pelo Amazon Bedrock
          (modelo Claude Haiku) para identificar potenciais alegações falsas. O modelo classifica
          cada publicação com uma pontuação de credibilidade (0–100):
        </p>
        <ul className="text-sm text-gray-600 space-y-2 mb-3">
          <li>
            <span className="font-medium text-gray-800">Verificável (0–39)</span>: nenhum indicador
            claro de desinformação.
          </li>
          <li>
            <span className="font-medium text-amber-700">Suspeito (40–69)</span>: alegação não
            verificada, mas não claramente falsa.
          </li>
          <li>
            <span className="font-medium text-red-700">Provável desinformação (≥ 70)</span>: alegação
            com alto grau de falsidade potencial.
          </li>
        </ul>
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
          <strong>Importante:</strong> um rótulo de desinformação não é um veredicto. É uma estimativa
          automatizada baseada em padrões linguísticos. Leia sempre o conteúdo original antes de
          tirar conclusões.
        </p>
        <div className="mt-4">
          <p className="text-sm text-gray-600 mb-2 font-medium">Tipos de alegações monitorados:</p>
          <div className="grid grid-cols-2 gap-1 text-xs text-gray-600">
            {[
              'Fraude na urna eletrônica',
              'Crime atribuído sem fonte verificável',
              'Compra de votos',
              'Alegação de golpe eleitoral',
              'Citação falsa atribuída a candidato',
              'Desinformação de saúde',
              'Dado econômico falso',
              'Interferência estrangeira',
            ].map(item => (
              <div key={item} className="flex items-start gap-1.5">
                <span className="text-gray-300 mt-0.5">—</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">5. Limitações</h2>
        <ul className="text-sm text-gray-600 space-y-2">
          {[
            'Redes sociais não são pesquisas eleitorais — volume de menções não equivale a votos.',
            'Atividade de bots não é filtrada; picos anormais podem distorcer os dados.',
            'O Comprehend pode ter desempenho reduzido com gírias, ironia e sarcasmo.',
            'Dados regionais (estado) disponíveis apenas quando a publicação indica localização.',
            'A cobertura de plataformas depende de APIs de terceiros com possíveis interrupções.',
          ].map(item => (
            <li key={item} className="flex items-start gap-2">
              <span className="text-gray-300 mt-0.5 flex-shrink-0">—</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">6. Privacidade (LGPD)</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          Usernames são armazenados internamente para fins operacionais e retidos por 30 dias, após
          os quais são excluídos. Na interface pública, todos os nomes de usuário são substituídos
          por um identificador anônimo no formato{' '}
          <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">usuário_XXXX</code>{' '}
          (primeiros 4 caracteres do hash SHA-256 do nome original). Links para publicações
          originais são mantidos para verificação de autoria. O painel não utiliza cookies de
          rastreamento nem coleta dados dos visitantes.
        </p>
      </section>
    </div>
  );
}
