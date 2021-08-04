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
sudo npm install forever -g
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
nohup forever start forever-config.json &

sudo nohup node --max_semi_space_size=30000 --max-old-space-size=30000 --initial-old-space-size=8000 --optimize-for-size --experimental-modules --experimental-json-modules  build/index.js &