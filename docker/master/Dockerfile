FROM jenkins/jenkins:lts

# Install custom plugins
COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN /usr/local/bin/install-plugins.sh < /usr/share/jenkins/ref/plugins.txt

USER root

RUN apt-get update &&\
        apt-get install -y python-pip &&\
        pip install jinja2 dnspython &&\
        rm -rf /var/lib/apt/lists/*

# Install aws-cli
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" &&\
        unzip awscliv2.zip &&\
        ./aws/install

# Install npm and aws-cdk
RUN curl -sL https://deb.nodesource.com/setup_12.x | bash -
RUN apt-get update -qq && apt-get install -qq --no-install-recommends \
        nodejs &&\
        rm -rf /var/lib/apt/lists/*
RUN npm i -g firebase-tools

# Install gcloud
RUN echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] http://packages.cloud.google.com/apt cloud-sdk main" | tee -a /etc/apt/sources.list.d/google-cloud-sdk.list &&\
        curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | apt-key --keyring /usr/share/keyrings/cloud.google.gpg  add - &&\
        apt-get update -y && apt-get install google-cloud-sdk jq -y

# Apply configuration-as-code
COPY config-as-code.yaml /config-as-code.yaml
# COPY modify_casc.py /modify_casc.py
# COPY config-as-code.j2 /config-as-code.j2
# RUN touch /config-as-code.yaml &&\
#         chown jenkins: /config-as-code.yaml &&\
#         sed -i '/\/bin\/bash*/a \\n\/modify_casc.py' /usr/local/bin/jenkins.sh

# User back to jenkins
USER jenkins
