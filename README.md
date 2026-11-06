# Site de l'ASC Bonsecours Handball

Site d'une seule page. Les matchs, les scores, les classements et la liste des
équipes se mettent à jour **tout seuls** toutes les 3 heures à partir de
ffhandball.fr. Personne n'a besoin de les saisir.

```
site/              le site (c'est ce dossier qui est publié)
  index.html       la page ; infos du club à modifier dans le bloc CLUB en bas du fichier
  data/ffhb.json   données FFHB (générées automatiquement, ne pas modifier à la main)
  data/ffhb.js     même chose, sous une forme lisible par la page
sync/              le script qui va chercher les données sur ffhandball.fr
.github/workflows/ la tâche automatique (synchro toutes les 3 h + mise en ligne)
```

Pour voir le site sur votre ordinateur, ouvrez `site/index.html` dans un navigateur.

## Mise en ligne

Le site est publié par **GitHub Pages** à l'adresse **https://hand.decatoire.fr**
(maquette pour le bureau du club). Chez IONOS, le sous-domaine `hand.decatoire.fr`
pointe vers GitHub par un enregistrement DNS `CNAME` → `paiikan.github.io`.

La tâche GitHub `.github/workflows/site.yml` fait tout :
1. elle récupère les données sur ffhandball.fr (toutes les 3 h) ;
2. s'il y a du nouveau, elle enregistre `site/data/` dans le dépôt ;
3. elle publie le dossier `site/` sur GitHub Pages.

Aucun mot de passe n'est nécessaire.

## Ce qui est automatique, et ce qui reste à compléter

| Automatique (ffhandball.fr) | À compléter dans `site/index.html`, bloc `CLUB` |
|---|---|
| Équipes engagées, nouvelles phases et poules | Horaires d'entraînement (`entrainements`) |
| Calendrier, horaires, scores | Téléphone (facultatif) |
| Classements | Responsable de la publication (`editeur`, mentions légales) |
| Résultats du week-end, prochain match à domicile | Nombre de licenciés (113 d'après la fiche « Mon Club ») |
| Logos des clubs | |

### Nouvelle saison (une fois par an, en septembre)

Depuis les serveurs de GitHub, la recherche « Club » de ffhandball.fr revient vide.
Le script s'appuie donc sur la liste `sync/competitions.json` (13 compétitions
pour 2026-2027). Les nouvelles phases et poules de ces compétitions sont
détectées automatiquement en cours de saison, mais **à chaque nouvelle saison il
faut mettre la liste à jour** : demandez-le à Claude, ou lancez
`node sync/sync.mjs --dry-run` depuis un ordinateur (la recherche y fonctionne).
Les numéros des compétitions figurent aussi à la fin de leurs adresses sur
ffhandball.fr.

## Si quelque chose ne marche plus

- **Les scores ne bougent plus** : onglet Actions, regardez le dernier passage de
  « Site du club ». S'il est en rouge, il est probable que ffhandball.fr ait
  changé quelque chose. Le site reste en ligne avec les dernières données
  connues.
- **GitHub met en pause les tâches planifiées après 60 jours sans activité dans
  le dépôt** (par exemple pendant l'été). Pour les relancer : Actions → Site du
  club → Enable workflow.
- **Le site affiche une erreur de certificat** : Settings → Pages → vérifier que
  « Custom domain » vaut `hand.decatoire.fr` et que « Enforce HTTPS » est coché.

## Comment ça marche (pour les curieux)

La FFHandball ne publie pas d'API officielle. Son site affiche les compétitions
à partir d'une route publique (`wp-json/competitions/v1/computeBlockAttributes`)
dont les réponses sont brouillées avec une clé écrite en clair sur chaque page.
Le script `sync/ffhb-core.mjs` fait exactement ce que fait le navigateur d'un
visiteur : il lit la clé, puis décode les réponses. Il n'envoie que des requêtes
publiques en lecture, sans compte, une fois toutes les 3 heures, avec une pause
entre chaque requête.

Ce fonctionnement n'est pas officiel : si la fédération modifie son site, le
script devra être adapté. En cas d'écart, ce sont les informations de
ffhandball.fr qui font foi.

Tests : `node --test sync/ffhb-core.test.mjs` (Node 18 ou plus récent)
Synchro manuelle : `node sync/sync.mjs`
