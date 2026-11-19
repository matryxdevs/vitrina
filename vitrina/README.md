# VITRINA 2.0 — Marketplace regional · MySQL Hostinger

Site de marketplace responsivo em português, visual preto/amarelo/branco, com login, perfis, busca por categoria/região/UF/cidade, anúncios pagos, chat interno, banners de propaganda administrados pelo proprietário e gestão de contas de usuários e vendedores. Backend Node.js + banco **MySQL** (`mysql2/promise`), adequado a aplicações Node.js na Hostinger.

**Atualização Hostinger (erro 503):** o `server.js` não possui mais `top-level await`, porque o iniciador LSNode.js da Hostinger tenta carregá-lo por `require()`, o que antes gerava `ERR_REQUIRE_ASYNC_MODULE`. A criação do esquema MySQL e da conta administrativa agora ocorre antes de iniciar a escuta da porta.

**Status deste pacote:** arquivos de código e SQL preparados; sintaxe e testes de estrutura executados. **Ainda não conectado a um MySQL real nem homologado em ambiente Hostinger ou Mercado Pago real.** Não trate o projeto como auditado ou pronto para receber dados financeiros/pessoais de produção sem executar o checklist final.

## O que foi acrescentado na versão 2

- **Categoria obrigatória ao anunciar:** o campo não tem escolha padrão, possui `required` no navegador e *allowlist* validada no backend. Categorias: Eletrônicos, Veículos, Imóveis, Casa e móveis, Eletrodomésticos, Ferramentas, Moda, Esporte e lazer, Serviços, Empregos e Outros.
- **Pesquisa ampliada:** caixa de busca e menu de categoria na página inicial; filtros avançados por palavra, categoria, região, UF e cidade.
- **Propaganda em destaque:** banners públicos criados pelo administrador com título, mensagem, imagem opcional, botão/URL HTTPS e prioridade; podem ser ativados, pausados ou excluídos. A propaganda é visível a **todos os visitantes**, com ou sem login. O administrador não paga para publicar esses banners.
- **Gestão de contas:** distinção entre usuário comum, anunciante e administrador; conversão automática para anunciante ao criar o primeiro anúncio; administrador pode suspender, bloquear e reativar contas comuns/anunciantes, permitir/proibir postagem e reclassificar contas. Ao bloquear/suspender, as sessões são encerradas e os anúncios publicados são ocultados.
- **Moderação de anúncios:** ocultar, remover e restaurar anúncio oculto apenas quando existe pagamento reconhecido e o anunciante está ativo. O sistema **não** publica anúncio de conta suspensa após o Webhook.
- **Financeiro administrativo:** consulta de pedidos de pagamento, sem alegar receita líquida ou estorno automático; auditoria básica de ações administrativas.
- **MySQL no lugar do SQLite:** tabelas InnoDB, consultas parametrizadas, pool de conexões e transações para mutações sensíveis.

## 1. Criar banco MySQL na Hostinger

1. No hPanel, abra o site e entre na área de **Bancos de dados / MySQL**. Crie um banco e um usuário com senha forte.
2. Copie o **nome completo do banco**, usuário e senha — na Hostinger o nome pode conter prefixo da conta.
3. Para hospedar o Node.js na mesma hospedagem Hostinger, use inicialmente `DB_HOST=127.0.0.1`, conforme a documentação de conexão Node.js→MySQL da Hostinger. A porta usual é `3306`. Se sua infraestrutura for diferente (VPS/serviços separados), use o host e regras de rede fornecidos pelo hPanel.
4. As tabelas podem ser criadas automaticamente na primeira inicialização (`DB_AUTO_SCHEMA=true`). Como alternativa, importe `db/schema.sql` pelo **phpMyAdmin** e defina `DB_AUTO_SCHEMA=false` em produção para não exigir permissões CREATE em toda inicialização.
5. Evite liberar o MySQL publicamente. A opção de **MySQL remoto** só deve ser ativada se realmente necessária, limitando o endereço IP autorizado, com TLS quando suportado.

Fontes oficiais: [conectar MySQL a Node.js](https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/), [publicar aplicação Node.js](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/) e [acesso remoto](https://www.hostinger.com/support/1583546-how-to-set-up-remote-mysql-access-in-hostinger/).

## 2. Configuração local no VS Code

**Pré-requisito:** Node.js versão 22.13 ou superior e acesso a um servidor MySQL 8+ ou MariaDB moderno (local ou Hostinger).

Abra a pasta `vitrina-marketplace-hostinger` no VS Code e rode:

```bash
npm install
```

Copie `.env.example` para `.env` e ajuste:

```ini
PORT=3000
APP_ORIGIN=http://localhost:3000
NODE_ENV=development
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=seu_banco_criado_no_hpanel
DB_USER=seu_usuario_mysql
DB_PASSWORD=sua_senha_mysql
DB_POOL_SIZE=6
DB_SSL=false
DB_AUTO_SCHEMA=true
ADMIN_EMAIL=admin@seudominio.com.br
ADMIN_PASSWORD=uma_senha_longa_de_20_ou_mais_caracteres
MP_ACCESS_TOKEN=
MP_WEBHOOK_SECRET=
PII_ENCRYPTION_KEY=
```

Na sequência:

```bash
npm run db:check
npm start
```

Abra `http://localhost:3000`. A conta admin é criada na primeira inicialização quando `ADMIN_EMAIL` e `ADMIN_PASSWORD` estão corretamente configurados (senha com pelo menos 16 caracteres). **Não crie a conta administrativa manualmente pelo cadastro comum**; o cadastro comum não permite obter privilégios de administração.

> Observação: localmente, para conectar ao MySQL da Hostinger pela internet, será necessário habilitar acesso remoto restrito no hPanel. É preferível desenvolver com um banco MySQL local e publicar o projeto na mesma hospedagem do banco.

## 3. Implantar no hPanel da Hostinger

1. Adicione um site/aplicativo **Node.js** no painel da Hostinger e envie o projeto por ZIP ou repositório GitHub, conforme recursos do seu plano. **Envie a pasta do projeto** com `package.json` na raiz. `node_modules` não precisa ir no ZIP.
2. Informe a versão Node.js compatível e o comando de inicialização **`npm start`**. A instalação deve executar `npm install` para instalar `mysql2`.
3. Crie variáveis de ambiente no painel para os valores de `.env.example` (não publique `.env` em repositório público). Defina `NODE_ENV=production`.
4. Configure `APP_ORIGIN=https://seu-dominio.com.br` com o domínio HTTPS exato, sem `/` no final, e habilite SSL/HTTPS.
5. Crie uma **chave AES-256-GCM permanente** para os WhatsApps:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Insira o resultado em `PII_ENCRYPTION_KEY`. Guarde cópia segura fora do ZIP e do Git. Se perder a chave, os WhatsApps armazenados ficarão irrecuperáveis.
6. Se usar criação automática de schema, faça o primeiro *deploy* com `DB_AUTO_SCHEMA=true`; depois de criadas as tabelas, importe/mantenha as próximas migrações sob controle e considere `DB_AUTO_SCHEMA=false`.
7. **Armazenamento de imagens:** a versão atual guarda fotos em `uploads/` do servidor. Verifique se a Hostinger preserva esse diretório entre reinstalações e *deploys*. Caso contrário, mova imagens para armazenamento persistente (S3, R2 ou equivalente) **antes** da produção.
8. Reinicie a aplicação, teste `/api/health`, crie duas contas, publique um anúncio de teste, filtre a categoria, teste chat e crie uma campanha administrativa.

**Importante:** publicar somente HTML/CSS/JS em `public_html` não basta. O projeto exige processo Node ativo, MySQL, pasta de imagens persistente e Webhook HTTPS.

## 4. Mercado Pago: cobrança de R$ 5 por cada anúncio

A integração de pagamentos é feita pelo **Mercado Pago**, da mesma empresa do Mercado Livre. Não se trata da API de anúncios do Mercado Livre.

1. No painel de desenvolvedores do Mercado Pago, configure a aplicação e obtenha o `MP_ACCESS_TOKEN` de teste.
2. Cadastre o Webhook **Order** com URL `https://seu-dominio.com.br/api/webhooks/mercadopago` e insira a assinatura secreta em `MP_WEBHOOK_SECRET`.
3. Faça ensaios com compradores de teste e confira a consulta do pedido. A API deve reconhecer **valor R$ 5,00, BRL, referência do anúncio e pagamento acreditado** para ativar apenas o respectivo rascunho.
4. Após validar o comportamento em sandbox, configure credenciais reais com domínio e webhook de produção.

**Um novo anúncio = um novo rascunho + uma nova cobrança independente.** O retorno do navegador da tela de pagamento nunca autoriza publicação sozinho. Banners criados pelo administrador não geram cobrança. Estornos não são automatizados; monitore cancelamentos e *chargebacks*.

Documentação oficial: https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/create-order

## 5. Administração

Entre com `ADMIN_EMAIL` e `ADMIN_PASSWORD`. Clique em **Minha conta → Painel administrativo**:

| Seção | Funções |
| --- | --- |
| Propagandas | Criar, ativar, pausar ou remover banners visíveis para todos |
| Usuários | Ver contas/contatos privados; classificar usuário e vendedor; ativar, suspender, bloquear; autorizar ou negar publicações |
| Anúncios | Ocultar, restaurar os previamente pagos ou remover |
| Denúncias | Conferir denúncias e ocultar conteúdo reportado |
| Pagamentos | Consultar pedidos registrados e respectivos estados |
| Auditoria | Ver parte das ações feitas pelo administrador, com data e alvo |

**WhatsApp privado:** a API pública e o chat não mostram esse campo; o titular vê o próprio número, e o administrador autenticado vê os números no painel. Os números são criptografados em repouso. Qualquer consulta administrativa de contatos registra evento de auditoria.

**Bloqueio de conta:** suspender ou banir usuário encerra sessões, impede operações autenticadas e oculta seus anúncios. Reativação da conta **não reativa anúncios automaticamente**. Um administrador deve usar a função de restauração caso o pagamento seja válido e o anúncio adequado.

## 6. Arquivos

```
vitrina-marketplace-hostinger/
├── server.js                 # API, autenticação, permissões, mensagens, pagamentos
├── db/
│   ├── mysql.js             # conexão mysql2, pool, transações e esquema
│   └── schema.sql           # tabelas InnoDB
├── public/
│   ├── index.html           # interface responsiva
│   ├── styles.css           # preto, amarelo e branco
│   └── app.js               # busca, formulários, campanhas e painel
├── scripts/check-db.mjs     # diagnóstico de conexão
├── tests/                   # verificações locais de estrutura e contratos
├── .env.example             # configuração (sem credenciais)
├── .gitignore
├── Dockerfile
└── package.json
```

## 7. Segurança e operação — obrigatório antes de lançar

As proteções implementadas incluem: derivação de senha por scrypt com salt, cookies HttpOnly/SameSite e Secure em produção, validação de origem, cabeçalhos de segurança e CSP, parametrização SQL, autorização por função/estado da conta, auditoria administrativa básica, proteção de WhatsApp AES-256-GCM, verificação de pagamento no servidor, checagem HMAC do Webhook e limitações locais de taxa de requisição.

**Isto não garante ausência de invasões.** Os seguintes pontos exigem atenção antes de aceitar clientes reais:

- Revisão independente de segurança, pentest, varredura de dependências, gestão de segredos, atualização contínua do Node.js/MySQL e firewall/WAF.
- **Autenticação de 2 fatores para o administrador**, recuperação de senha e verificação de e-mail (ainda não implementados).
- Regras de moderação, prevenção a fraudes, conteúdo proibido, tratamento de denúncias e política de retirada.
- LGPD: base legal, transparência, política de privacidade, termos de uso, retenção/exclusão de dados, canal de atendimento a titulares e minimização de dados pessoais.
- Backups cifrados e restauráveis de MySQL, pasta de fotos e chave AES. Nunca inclua backups/.env no diretório web.
- Segurança de imagens (remoção de EXIF, reprocessamento e varredura por biblioteca), proteção de arquivos e uso de armazenamento dedicado em escala.
- Monitoramento de Webhooks, conferência financeira e tratamento de estornos/contestação. Medidas de `rate limit` atualmente são apenas em memória do processo.
- Testes reais de integração em MySQL Hostinger, compras Mercado Pago sandbox, testes mobile, acessibilidade e volume de usuários.

### Migração de dados da edição anterior (SQLite)

Esta versão é preparada para um **novo banco MySQL**. O pacote anterior em SQLite **não é migrado automaticamente**. Se você já usou a primeira versão com usuários e anúncios reais, será necessário planejar migração de IDs, senhas derivadas, números cifrados (com a **chave AES antiga**), imagens, pedidos e relacionamentos. Não delete o SQLite antigo até conferir tudo.

---

O ZIP não inclui credenciais reais, fotos de usuários, banco MySQL ou acesso ao hPanel. Configure os serviços com sua conta para começar.
