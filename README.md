```
cd /opt
mkdir bitnami
sudo mkdir bitnami
cd bitnami
chmod 777 .
sudo chmod 777 .
mkdir projects
cd projects
ssh-keygen -t ed25519 -C "deploy@rune.farm"
cat ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub
sudo apt update
curl -sL https://deb.nodesource.com/setup_14.x | sudo bash -
sudo apt -y install nodejs
npm install forever -g
sudo npm install forever -g
sudo apt-get git
sudo apt-get install git
git clone git@github.com:RuneFarm/rune-evolution-game-server.git
cd rune-evolution-game-server/
git checkout na1
sudo add-apt-repository ppa:certbot/certbot
sudo apt-get install certbot
sudo certbot certonly --manual
sudo cat /etc/letsencrypt/live/na1.runeevolution.com/fullchain.pem
sudo cat /etc/letsencrypt/live/na1.runeevolution.com/privkey.pem
git pull
yarn build

sudo nohup forever start forever-config.json &
```


Download:

gcloud compute scp rune-evolution-asia1:/opt/bitnami/projects/rune-evolution-game-server/public/data/leaderboardHistory.json ~/Documents/a/ --zone "asia-northeast1-b"  --project "rune-evolution-ptr"


Upload:

gcloud compute scp ~/Documents/a/leaderboardHistory.json rune-evolution-asia1:/opt/bitnami/projects/rune-evolution-game-server/public/data/leaderboardHistory.json --zone "asia-northeast1-b"  --project "rune-evolution-ptr"



